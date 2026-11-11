/**
 * Buen Rollo · Sincronización Google Sheets ⇄ App (Supabase)
 *
 * Cómo instalarlo (una sola vez):
 *  1. En la planilla: Extensiones → Apps Script. Borrá lo que haya y pegá este archivo completo. Guardá.
 *  2. Engranaje "Configuración del proyecto" → "Propiedades del script" → Agregar:
 *       SYNC_TOKEN = (la clave que te pasó Claude o la que generás en la app: Más → Ajustes → Google Sheets)
 *  3. Volvé a la planilla, recargala y usá el menú  Buen Rollo → Activar sincronización automática.
 *     Google te va a pedir permiso la primera vez (es tu propio script).
 *
 * Qué se sincroniza:
 *  - Productos:  app ⇄ planilla. Podés cambiar nombre, código de barras, costo, precio, stock, stock mínimo y "Activo".
 *                Para agregar un producto, escribí una fila nueva al final (el SKU se genera solo si lo dejás vacío).
 *                El stock se ajusta por diferencia, así no se pisan ventas hechas mientras tanto.
 *  - Compras:    app ⇄ planilla. Para cargar una compra desde acá, agregá filas al final con la columna ID vacía.
 *                Suma stock y actualiza el costo; si completás "Precio venta nuevo" también cambia el precio.
 *  - Precios proveedores: app ⇄ planilla. Pegá la lista de un proveedor al final (ID vacío) y aparece en el comparador.
 *  - Ventas y Resumen: sólo app → planilla (las ventas se cargan desde la app).
 */

const SUPABASE_URL = 'https://nscbmuulxzrwqbsvmudm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cO_R_m86IAGkoRVAw9jobQ_2yzGCTC0';

const HOJAS = {
  productos: {
    nombre: 'Productos',
    encabezados: ['SKU', 'Producto', 'Código de barras', 'Costo', 'Precio venta', 'Stock', 'Stock mínimo', 'Estado', 'Margen %', 'Activo', 'Actualizado', '_stock_original', '_editado'],
  },
  ventas: {
    nombre: 'Ventas',
    encabezados: ['Fecha y hora', 'Nro pedido', 'SKU', 'Producto', 'Cantidad', 'Precio unit.', 'Total', 'Método de pago', 'Cliente', 'Vendedor/a', 'Notas', 'Estado'],
  },
  compras: {
    nombre: 'Compras',
    encabezados: ['ID', 'Fecha', 'Proveedor', 'Comprobante', 'SKU', 'Producto', 'Cantidad', 'Costo unit.', 'Precio venta nuevo', 'Subtotal', 'Costo anterior', 'Variación %', 'Origen'],
  },
  precios: {
    nombre: 'Precios proveedores',
    encabezados: ['ID', 'Proveedor', 'Código', 'Descripción', 'Precio', 'Fecha lista', 'SKU vinculado', 'Producto vinculado', 'Mi costo', 'Dif. vs mi costo %'],
  },
  resumen: { nombre: 'Resumen' },
};

// ───────────────────────── Menú ─────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Buen Rollo')
    .addItem('Sincronizar ahora', 'sincronizar')
    .addItem('Activar sincronización automática (cada 5 min)', 'activarAutomatica')
    .addItem('Desactivar sincronización automática', 'desactivarAutomatica')
    .addToUi();
}

function activarAutomatica() {
  desactivarAutomatica();
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  prepararHojas_();
  sincronizar();
  SpreadsheetApp.getActive().toast('Listo: se sincroniza sola cada 5 minutos.', 'Buen Rollo', 5);
}

function desactivarAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sincronizar', 'alEditar'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

// Marca las filas de Productos que se editaron a mano, para mandarlas a la app.
function alEditar(e) {
  if (!e || !e.range) return;
  var hoja = e.range.getSheet();
  if (hoja.getName() !== HOJAS.productos.nombre || e.range.getRow() < 2) return;
  var colEditado = HOJAS.productos.encabezados.indexOf('_editado') + 1;
  if (e.range.getColumn() >= colEditado - 1) return; // cambios en columnas internas
  hoja.getRange(e.range.getRow(), colEditado, e.range.getNumRows(), 1).setValue(true);
}
function onEdit(e) { alEditar(e); }

// ───────────────────────── Sincronización ─────────────────────────
function sincronizar() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    prepararHojas_();
    var errores = [];
    try { subirProductos_(); } catch (e) { errores.push('Productos: ' + e.message); }
    try { subirCompras_(); } catch (e) { errores.push('Compras: ' + e.message); }
    try { subirPrecios_(); } catch (e) { errores.push('Precios: ' + e.message); }
    if (errores.length) {
      // No se reescribe nada para no perder lo que todavía no se subió.
      escribirEstado_('⚠️ Error: ' + errores.join(' | '));
      return;
    }
    var datos = rpc_('sync_exportar', {});
    escribirProductos_(datos.productos);
    escribir_(HOJAS.ventas, datos.ventas);
    escribir_(HOJAS.compras, datos.compras.map(function (c) {
      // [id, fecha, prov, nro, sku, nombre, cant, costo, subtotal, costo_ant, var, origen] → con "Precio venta nuevo" vacío
      return [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], '', c[8], c[9], c[10], c[11]];
    }));
    escribir_(HOJAS.precios, datos.precios);
    escribirResumen_(datos);
    escribirEstado_('✅ Sincronizado ' + Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM HH:mm'));
  } finally {
    lock.releaseLock();
  }
}

function subirProductos_() {
  var h = hoja_(HOJAS.productos);
  var ultima = h.getLastRow();
  if (ultima < 2) return;
  var enc = HOJAS.productos.encabezados;
  var vals = h.getRange(2, 1, ultima - 1, enc.length).getValues();
  var col = function (n) { return enc.indexOf(n); };
  var filas = [];
  vals.forEach(function (r, i) {
    if (r[col('_editado')] !== true || !String(r[col('Producto')]).trim()) return;
    filas.push({
      fila: i + 2,
      sku: String(r[col('SKU')] || '').trim(),
      nombre: String(r[col('Producto')]).trim(),
      codigo_barras: String(r[col('Código de barras')] || '').trim(),
      costo: numero_(r[col('Costo')]),
      precio: numero_(r[col('Precio venta')]),
      stock: numero_(r[col('Stock')]),
      stock_original: numero_(r[col('_stock_original')]),
      stock_minimo: numero_(r[col('Stock mínimo')]),
      activo: String(r[col('Activo')] || 'Sí'),
    });
  });
  if (!filas.length) return;
  rpc_('sync_productos', { p_filas: filas });
  filas.forEach(function (f) { h.getRange(f.fila, col('_editado') + 1).setValue(false); });
}

function subirCompras_() {
  var h = hoja_(HOJAS.compras);
  var ultima = h.getLastRow();
  if (ultima < 2) return;
  var vals = h.getRange(2, 1, ultima - 1, HOJAS.compras.encabezados.length).getValues();
  var filas = [];
  vals.forEach(function (r, i) {
    var id = r[0], cant = numero_(r[6]), costo = numero_(r[7]);
    if (id !== '' || (!r[4] && !r[5]) || cant === '' || costo === '') return;
    filas.push({
      fila: i + 2, fecha: fecha_(r[1]), proveedor: String(r[2] || ''), nro: String(r[3] || ''),
      sku: String(r[4] || ''), producto: String(r[5] || ''), cantidad: cant, costo: costo, precio_nuevo: numero_(r[8]),
    });
  });
  if (!filas.length) return;
  var res = rpc_('sync_compras', { p_filas: filas });
  res.forEach(function (g) { g.filas.forEach(function (f) { h.getRange(f, 1).setValue(g.compra_id); }); });
}

function subirPrecios_() {
  var h = hoja_(HOJAS.precios);
  var ultima = h.getLastRow();
  if (ultima < 2) return;
  var vals = h.getRange(2, 1, ultima - 1, HOJAS.precios.encabezados.length).getValues();
  var filas = [];
  vals.forEach(function (r, i) {
    if (r[0] !== '' || !r[1] || numero_(r[4]) === '') return;
    filas.push({ fila: i + 2, proveedor: String(r[1]), codigo: String(r[2] || ''), descripcion: String(r[3] || ''), precio: numero_(r[4]), fecha: fecha_(r[5]), sku: String(r[6] || '') });
  });
  if (!filas.length) return;
  var res = rpc_('sync_precios', { p_filas: filas });
  res.forEach(function (x) { h.getRange(x.fila, 1).setValue(x.id); });
}

// ───────────────────────── Escritura ─────────────────────────
function escribirProductos_(productos) {
  // agrega las columnas internas: stock original (para ajustar por diferencia) y "editado"
  var filas = productos.map(function (p) { return p.concat([p[5], false]); });
  escribir_(HOJAS.productos, filas);
}

function escribir_(def, filas) {
  var h = hoja_(def);
  var n = def.encabezados.length;
  var actuales = h.getMaxRows() - 1;
  if (actuales > 0) h.getRange(2, 1, actuales, n).clearContent();
  if (filas.length) {
    if (h.getMaxRows() < filas.length + 1) h.insertRowsAfter(h.getMaxRows(), filas.length + 1 - h.getMaxRows());
    h.getRange(2, 1, filas.length, n).setValues(filas.map(function (f) {
      return f.slice(0, n).map(function (v) { return v === null || v === undefined ? '' : v; });
    }));
  }
}

function escribirResumen_(d) {
  var h = hoja_(HOJAS.resumen);
  var r = d.resumen || {};
  var reponer = d.productos.filter(function (p) { return p[7] !== 'OK'; }).length;
  h.getRange('A1:B9').setValues([
    ['📊 RESUMEN (se actualiza solo)', ''],
    ['Ventas de hoy', r.ventas_hoy || 0],
    ['Ventas del mes', r.ventas_mes || 0],
    ['Ganancia del mes', r.ganancia_mes || 0],
    ['Productos cargados', d.productos.length],
    ['Productos a reponer ⚠️', reponer],
    ['', ''],
    ['Última sincronización', Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm')],
    ['Estado', ''],
  ]);
  h.getRange('B2:B4').setNumberFormat('$ #,##0');
}

function escribirEstado_(t) { hoja_(HOJAS.resumen).getRange('B9').setValue(t); }

// ───────────────────────── Preparación y formato ─────────────────────────
function prepararHojas_() {
  [HOJAS.productos, HOJAS.ventas, HOJAS.compras, HOJAS.precios].forEach(function (def) {
    var h = hoja_(def);
    var enc = h.getRange(1, 1, 1, def.encabezados.length);
    if (enc.getValues()[0].join('|') !== def.encabezados.join('|')) {
      enc.setValues([def.encabezados]).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
      h.setFrozenRows(1);
    }
  });
  var p = hoja_(HOJAS.productos);
  var ip = HOJAS.productos.encabezados.indexOf('_stock_original') + 1;
  p.hideColumns(ip, 2);
  p.getRange('D:E').setNumberFormat('$ #,##0.##');
  hoja_(HOJAS.ventas).getRange('F:G').setNumberFormat('$ #,##0');
  hoja_(HOJAS.compras).getRange('H:K').setNumberFormat('$ #,##0.##');
  hoja_(HOJAS.precios).getRange('E:E').setNumberFormat('$ #,##0.##');
  hoja_(HOJAS.precios).getRange('I:I').setNumberFormat('$ #,##0.##');
}

function hoja_(def) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(def.nombre) || ss.insertSheet(def.nombre);
}

// ───────────────────────── Utilidades ─────────────────────────
function rpc_(fn, params) {
  var token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!token) throw new Error('Falta SYNC_TOKEN en Propiedades del script');
  params.p_token = token;
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify(params),
    muteHttpExceptions: true,
  });
  var codigo = res.getResponseCode();
  var cuerpo = res.getContentText();
  if (codigo >= 300) {
    var msg = cuerpo;
    try { msg = JSON.parse(cuerpo).message || cuerpo; } catch (e) {}
    throw new Error(msg);
  }
  return JSON.parse(cuerpo);
}

function numero_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[^\d.,-]/g, '');
  if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  var n = Number(s);
  return isNaN(n) ? '' : n;
}

function fecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
  if (!v) return '';
  var m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return String(v);
}
