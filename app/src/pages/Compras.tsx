import { useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { useConfig, useProductosDueno } from '../lib/catalogo'
import { $, fecha, filtrar, hoyISO, n, norm, pct, precioSugerido, similitud } from '../lib/formato'
import { detectarTablas, leerArchivo, leerRenglones, type TablaDetectada } from '../lib/planillas'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Estado = 'manual' | 'reconocido' | 'sugerido' | 'sin_vincular' | 'nuevo'
type Item = {
  key: string
  producto: Producto | null      // null = producto nuevo (o sin vincular todavía)
  nombreNuevo: string
  cantidad: string               // en la unidad del comprobante (bultos o unidades)
  costo: string                  // por unidad del comprobante
  upb: string                    // unidades por bulto
  precioNuevo: string            // '' = mantener precio actual
  codigoProv: string
  descProv: string
  estado: Estado
  dudoso?: boolean
}
type CompraHist = { id: number; fecha: string; nro_comprobante: string | null; total: number; origen: string; fotos: string[]; proveedores: { nombre: string } | null; compra_items: { nombre: string; cantidad: number; costo_unit: number; costo_anterior: number | null }[] }
type MejorPrecio = { producto_id: number; proveedor: string; precio_proveedor: number; es_mas_barato: boolean }
type Equivalencia = { proveedor_id: number; codigo_proveedor: string | null; descripcion_proveedor: string; producto_id: number; unidades_por_bulto: number; proveedores: { nombre: string } }
type ItemLeido = { codigo?: string; descripcion: string; cantidad: number; unidades_por_bulto?: number; precio_unitario: number; legible?: boolean }
type Leido = { proveedor?: string; nro_comprobante?: string; fecha?: string; iva_discriminado?: boolean; iva_porcentaje?: number; items: ItemLeido[]; total?: number; observaciones?: string }

const num = (s: string) => { const x = Number(String(s).replace(/\s/g, '').replace(',', '.')); return String(s).trim() === '' || isNaN(x) ? null : x }
const nuevaKey = () => crypto.randomUUID?.() ?? String(Math.random())
const unidades = (i: Item) => (num(i.cantidad) ?? 0) * (num(i.upb) || 1)

export default function Compras() {
  const { productos, recargar } = useProductosDueno()
  const { config } = useConfig()
  const [proveedores, setProveedores] = useState<string[]>([])
  const [proveedor, setProveedor] = useState('')
  const [nro, setNro] = useState('')
  const [dia, setDia] = useState(hoyISO())
  const [items, setItems] = useState<Item[]>([])
  const [ivaPct, setIvaPct] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const [q, setQ] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [historial, setHistorial] = useState<CompraHist[]>([])
  const [mejores, setMejores] = useState<Record<number, MejorPrecio>>({})
  const [abierta, setAbierta] = useState<number | null>(null)
  const [fotos, setFotos] = useState<string[]>([])
  const [leyendo, setLeyendo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [totalLeido, setTotalLeido] = useState<number | null>(null)
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [tablas, setTablas] = useState<{ hoja: string; tabla: TablaDetectada; filas: unknown[][]; n: number; muestra: string[] }[] | null>(null)

  async function cargarHist() {
    const { data } = await supabase.from('compras').select('id,fecha,nro_comprobante,total,origen,fotos,proveedores(nombre),compra_items(nombre,cantidad,costo_unit,costo_anterior)').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(30)
    setHistorial((data as unknown as CompraHist[]) ?? [])
  }
  useEffect(() => {
    supabase.from('proveedores').select('nombre').order('nombre').then(({ data }) => setProveedores((data ?? []).map((p) => p.nombre)))
    supabase.rpc('comparar_precios').then(({ data }) => {
      const m: Record<number, MejorPrecio> = {}
      for (const r of (data as MejorPrecio[]) ?? []) if (r.es_mas_barato && !m[r.producto_id]) m[r.producto_id] = r
      setMejores(m)
    })
    cargarHist()
  }, [])

  const resultados = useMemo(() => filtrar(productos, q, 25), [productos, q])
  const costoUnit = (i: Item) => { const c = num(i.costo); return c == null ? null : (c / (num(i.upb) || 1)) * (1 + ivaPct / 100) }
  const total = items.reduce((s, i) => s + (num(i.cantidad) ?? 0) * (num(i.costo) ?? 0), 0) * (1 + ivaPct / 100)

  function agregar(p: Producto | null) {
    setItems((it) => [...it, { key: nuevaKey(), producto: p, nombreNuevo: p ? '' : q.toUpperCase(), cantidad: '1', costo: p?.costo ? String(p.costo) : '', upb: '1', precioNuevo: '', codigoProv: '', descProv: '', estado: p ? 'manual' : 'nuevo' }])
    setBuscando(false); setQ('')
  }
  const upd = (key: string, cambios: Partial<Item>) => setItems((it) => it.map((i) => (i.key === key ? { ...i, ...cambios } : i)))

  // ── Excel del comprobante → renglones vinculados ──
  async function subirAdjunto(file: File) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const ruta = `${hoyISO().slice(0, 7)}/${nuevaKey()}.${ext}`
    const { error } = await supabase.storage.from('comprobantes').upload(ruta, file, { contentType: file.type || undefined })
    if (!error) setFotos((f) => [...f, ruta])
  }

  async function leerExcel(file?: File) {
    if (!file) return
    if (!proveedor.trim()) { setMsg({ ok: false, t: 'Elegí primero el proveedor, así reconozco sus códigos.' }); return }
    setMsg(null); setLeyendo('Leyendo el Excel…')
    try {
      const libro = await leerArchivo(file)
      const encontradas: { hoja: string; tabla: TablaDetectada; filas: unknown[][]; n: number; muestra: string[] }[] = []
      for (const hoja of libro.hojas) {
        const filas = libro.filas(hoja)
        for (const t of detectarTablas(filas)) {
          const r = leerRenglones(filas, t)
          if (r.length) encontradas.push({ hoja, tabla: t, filas, n: r.length, muestra: r.slice(0, 3).map((x) => x.descripcion) })
        }
      }
      if (!encontradas.length) throw new Error('No encontré la tabla de productos. Los títulos de las columnas tienen que decir algo como Código, Cantidad, Descripción y Precio.')
      subirAdjunto(file)
      if (encontradas.length === 1) await importarTabla(encontradas[0].filas, encontradas[0].tabla)
      else setTablas(encontradas)
    } catch (e) {
      setMsg({ ok: false, t: mensajeError(e) })
    } finally {
      setLeyendo('')
    }
  }

  async function importarTabla(filas: unknown[][], tabla: TablaDetectada) {
    setTablas(null)
    const renglones = leerRenglones(filas, tabla)
    await aplicarLectura({ items: renglones.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: r.cantidad, precio_unitario: r.precio_unitario })), total: renglones.reduce((s, r) => s + (r.total ?? r.cantidad * r.precio_unitario), 0) })
  }

  async function aplicarLectura(l: Leido) {
    // proveedor: el más parecido de los que ya existen
    let prov = l.proveedor?.trim() || proveedor.trim()
    if (prov) {
      const mejor = proveedores.map((p) => ({ p, s: Math.max(similitud(p, prov), norm(prov).includes(norm(p)) ? 0.9 : 0) })).sort((a, b) => b.s - a.s)[0]
      if (mejor && mejor.s >= 0.5) prov = mejor.p
    }
    if (prov && !proveedor) setProveedor(prov)
    if (l.nro_comprobante && !nro) setNro(l.nro_comprobante)
    if (l.fecha && /^\d{4}-\d{2}-\d{2}$/.test(l.fecha)) setDia(l.fecha)
    if (l.iva_discriminado && l.iva_porcentaje) setIvaPct(l.iva_porcentaje)
    setObservaciones(l.observaciones ?? '')
    setTotalLeido(l.total ?? null)

    // equivalencias aprendidas de este proveedor
    const { data } = await supabase.from('equivalencias').select('proveedor_id,codigo_proveedor,descripcion_proveedor,producto_id,unidades_por_bulto,proveedores!inner(nombre)')
    const eqs = ((data as unknown as Equivalencia[]) ?? []).filter((e) => !prov || norm(e.proveedores.nombre) === norm(prov))
    const porId = new Map(productos.map((p) => [p.id, p]))
    const porBarras = new Map(productos.filter((p) => p.codigo_barras).map((p) => [p.codigo_barras!, p]))

    const nuevos: Item[] = l.items.map((it) => {
      const codigo = (it.codigo ?? '').replace(/^\*/, '').trim()
      const desc = (it.descripcion ?? '').trim()
      const eq = eqs.find((e) => codigo && e.codigo_proveedor === codigo) ?? eqs.find((e) => norm(e.descripcion_proveedor) === norm(desc))
      let producto: Producto | null = null, estado: Estado = 'sin_vincular', upb = it.unidades_por_bulto && it.unidades_por_bulto > 1 ? it.unidades_por_bulto : 1
      if (eq && porId.get(eq.producto_id)) { producto = porId.get(eq.producto_id)!; estado = 'reconocido'; upb = Number(eq.unidades_por_bulto) || upb }
      else if (codigo && porBarras.get(codigo)) { producto = porBarras.get(codigo)!; estado = 'reconocido' }
      else {
        let mejor: Producto | null = null, s = 0
        for (const p of productos) { const x = similitud(desc, p.nombre); if (x > s) { s = x; mejor = p } }
        if (mejor && s >= 0.42) { producto = mejor; estado = 'sugerido' }
      }
      return {
        key: nuevaKey(), producto, nombreNuevo: producto ? '' : desc.toUpperCase(),
        cantidad: String(it.cantidad ?? 1), costo: String(it.precio_unitario ?? ''), upb: String(upb), precioNuevo: '',
        codigoProv: codigo, descProv: desc, estado, dudoso: it.legible === false,
      }
    })
    setItems((prev) => [...prev, ...nuevos])
    const rec = nuevos.filter((i) => i.estado === 'reconocido').length
    setMsg({ ok: true, t: `Leí ${nuevos.length} renglones: ${rec} reconocidos, ${nuevos.filter((i) => i.estado === 'sugerido').length} sugeridos para revisar y ${nuevos.filter((i) => i.estado === 'sin_vincular').length} sin vincular.` })
  }

  async function registrar() {
    setMsg(null)
    for (const i of items) {
      if (!(num(i.cantidad)! > 0) || num(i.costo) == null) { setMsg({ ok: false, t: `Revisá cantidad y costo de ${i.producto?.nombre ?? (i.nombreNuevo || i.descProv)}` }); return }
      if (i.estado === 'sin_vincular') { setMsg({ ok: false, t: `"${i.descProv}": elegí a qué producto tuyo corresponde o marcalo como producto nuevo` }); return }
      if (!i.producto && !i.nombreNuevo.trim()) { setMsg({ ok: false, t: `Falta vincular "${i.descProv}" a un producto (o darle nombre como producto nuevo)` }); return }
      if (!(num(i.upb)! > 0)) { setMsg({ ok: false, t: 'Unidades por bulto inválidas' }); return }
    }
    const sugeridos = items.filter((i) => i.estado === 'sugerido').length
    if (sugeridos && !confirm(`Hay ${sugeridos} renglón(es) vinculados por parecido que no confirmaste. ¿Registrar igual?`)) return
    setGuardando(true)
    const { error } = await supabase.rpc('cargar_compra', {
      p_proveedor: proveedor, p_nro_comprobante: nro || null, p_fecha: dia, p_fotos: fotos,
      p_notas: ivaPct ? `Costos con IVA ${ivaPct}% incluido` : null,
      p_items: items.map((i) => ({
        producto_id: i.producto?.id ?? null, nombre: i.producto?.nombre ?? i.nombreNuevo,
        cantidad: unidades(i), costo: Math.round(costoUnit(i)! * 100) / 100, precio_nuevo: num(i.precioNuevo),
        codigo_proveedor: i.codigoProv || null, descripcion_proveedor: i.descProv || null, unidades_por_bulto: num(i.upb) || 1,
      })),
    })
    setGuardando(false)
    if (error) { setMsg({ ok: false, t: mensajeError(error) }); return }
    const subieron = items.filter((i) => num(i.precioNuevo) != null).length
    setMsg({ ok: true, t: `Compra registrada por ${$(total)}. Stock actualizado${subieron ? ` y ${subieron} precio(s) cambiados` : ''}. Las equivalencias quedaron guardadas para la próxima factura.` })
    setItems([]); setNro(''); setFotos([]); setIvaPct(0); setObservaciones(''); setTotalLeido(null)
    recargar(); cargarHist()
  }

  const vinculandoItem = items.find((i) => i.key === vinculando)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Cargar compra</h1>

      <div className="tarjeta p-3 space-y-2">
        <div>
          <label className="etiqueta">Proveedor</label>
          <input list="provs" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="campo" placeholder="Ej: Gran Tornado" />
          <datalist id="provs">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="etiqueta">Nº comprobante</label><input value={nro} onChange={(e) => setNro(e.target.value)} className="campo" /></div>
          <div><label className="etiqueta">Fecha</label><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="campo" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ivaPct > 0} onChange={(e) => setIvaPct(e.target.checked ? 21 : 0)} className="w-5 h-5 accent-marca" />
          Los precios no incluyen IVA: sumar
          <input value={ivaPct || 21} onChange={(e) => setIvaPct(Number(e.target.value) || 0)} disabled={!ivaPct} className="campo w-16 py-1 px-2 num" inputMode="decimal" />% al costo
        </label>
        {fotos.length > 0 && <p className="text-xs text-stone-500">📎 {fotos.length} archivo(s) adjunto(s) a esta compra</p>}
      </div>

      <label className={`tarjeta p-4 flex items-center gap-3 cursor-pointer border-2 border-dashed border-marca/40 bg-marca-claro/30 ${leyendo ? 'pointer-events-none opacity-70' : ''} ${!proveedor.trim() ? 'opacity-60' : ''}`}>
        <span className="w-12 h-12 rounded-xl bg-marca text-white grid place-items-center shrink-0"><Icono n="subir" className="w-6 h-6" /></span>
        <span className="flex-1"><b>Cargar el Excel del comprobante</b><span className="block text-sm text-stone-600">{leyendo || (proveedor.trim() ? 'El que armás escaneando la factura (.xlsx, .xls o .csv). Reconozco la tabla sola.' : 'Primero elegí el proveedor arriba.')}</span></span>
        <input type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden" onChange={(e) => { leerExcel(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <label className="flex items-center justify-center gap-2 text-sm text-marca font-semibold cursor-pointer">
        <Icono n="camara" className="w-4 h-4" /> Adjuntar foto de la factura (opcional)
        <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { [...(e.target.files ?? [])].forEach(subirAdjunto); e.target.value = '' }} />
      </label>

      {tablas && (
        <div className="tarjeta p-3 space-y-2">
          <b>Encontré {tablas.length} tablas en el archivo. ¿Cuál es la de esta compra?</b>
          {tablas.map((t, k) => (
            <button key={k} onClick={() => importarTabla(t.filas, t.tabla)} className="w-full text-left rounded-xl border border-stone-200 p-2.5 hover:border-marca">
              <div className="text-sm font-semibold">{t.n} productos · hoja “{t.hoja}”</div>
              <div className="text-xs text-stone-500">{t.muestra.join(' · ')}…</div>
            </button>
          ))}
        </div>
      )}

      {observaciones && <p className="rounded-xl px-3 py-2 bg-amber-50 text-amber-900 text-sm">⚠️ {observaciones}</p>}

      {items.map((i) => (
        <FilaCompra key={i.key} i={i} upd={upd} quitar={() => setItems((it) => it.filter((x) => x.key !== i.key))}
          margen={config.margen_objetivo} redondeo={config.redondeo} mejor={i.producto ? mejores[i.producto.id] : undefined}
          proveedor={proveedor} costoUnit={costoUnit(i)} onVincular={() => setVinculando(i.key)} />
      ))}

      {buscando ? (
        <div className="tarjeta p-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo mb-2" placeholder="Buscar producto…" />
          <ul className="divide-y divide-stone-100 max-h-72 overflow-y-auto">
            {resultados.map((p) => (
              <li key={p.id}><button onClick={() => agregar(p)} className="w-full text-left py-2 flex justify-between gap-2"><span>{p.nombre}</span><span className="text-sm text-stone-500 num">{$(p.costo)}</span></button></li>
            ))}
          </ul>
          <div className="flex gap-2 mt-2">
            <button onClick={() => agregar(null)} className="btn-secundario flex-1"><Icono n="sumar" /> Producto nuevo{q && `: ${q}`}</button>
            <button onClick={() => setBuscando(false)} className="btn-secundario">Cancelar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setBuscando(true)} className="btn-secundario w-full border-dashed py-3"><Icono n="sumar" /> Agregar producto a mano</button>
      )}

      {items.length > 0 && (
        <div className="tarjeta p-4">
          <div className="flex justify-between items-center"><span className="text-stone-500">Total compra{ivaPct ? ` (con IVA ${ivaPct}%)` : ''}</span><span className="text-2xl font-extrabold num">{$(total)}</span></div>
          {totalLeido != null && Math.abs(totalLeido - total) > Math.max(1, totalLeido * 0.01) && (
            <p className="text-sm text-amber-800 mt-1">El comprobante dice {$(totalLeido)}. Revisá si falta o sobra algún renglón, descuentos o percepciones.</p>
          )}
          <button onClick={registrar} disabled={guardando} className="btn-primario w-full py-3.5 mt-3">{guardando ? 'Guardando…' : 'Registrar compra'}</button>
        </div>
      )}
      {msg && <p className={`rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}

      <h2 className="text-lg font-bold pt-2">Últimas compras</h2>
      <ul className="tarjeta divide-y divide-stone-100">
        {historial.map((c) => (
          <li key={c.id}>
            <button onClick={() => setAbierta(abierta === c.id ? null : c.id)} className="w-full text-left px-3 py-2.5 flex justify-between gap-2">
              <span><b>{c.proveedores?.nombre ?? 'Sin proveedor'}</b><span className="block text-xs text-stone-500">{fecha(c.fecha)} · {c.compra_items.length} prod.{c.nro_comprobante ? ` · ${c.nro_comprobante}` : ''}{c.origen === 'sheets' ? ' · desde Sheets' : ''}{c.fotos?.length ? ' · 📎' : ''}</span></span>
              <span className="font-bold num">{$(c.total)}</span>
            </button>
            {abierta === c.id && (
              <div className="px-3 pb-3 text-sm">
                {c.compra_items.map((it, k) => {
                  const v = it.costo_anterior ? ((it.costo_unit - it.costo_anterior) / it.costo_anterior) * 100 : null
                  return <div key={k} className="flex justify-between gap-2 py-0.5"><span>{n(it.cantidad)} × {it.nombre}</span><span className="num">{$(it.costo_unit)} {v ? <span className={v > 0 ? 'text-red-600' : 'text-emerald-700'}>{pct(v)}</span> : null}</span></div>
                })}
                {c.fotos?.map((f) => <VerFoto key={f} ruta={f} />)}
              </div>
            )}
          </li>
        ))}
      </ul>

      {vinculandoItem && (
        <ElegirProducto productos={productos} texto={vinculandoItem.descProv || vinculandoItem.nombreNuevo}
          onElegir={(p) => { upd(vinculandoItem.key, p ? { producto: p, estado: 'manual', nombreNuevo: '' } : { producto: null, estado: 'nuevo', nombreNuevo: vinculandoItem.descProv.toUpperCase() }); setVinculando(null) }}
          onCerrar={() => setVinculando(null)} />
      )}
    </div>
  )
}

function VerFoto({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState('')
  return url
    ? <a href={url} target="_blank" rel="noreferrer" className="text-marca underline block mt-1">Abrir archivo</a>
    : <button onClick={async () => { const { data } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 600); if (data) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank') } }} className="text-marca underline block mt-1">📎 Ver archivo del comprobante</button>
}

const CHIP: Record<Estado, [string, string]> = {
  reconocido: ['bg-emerald-100 text-emerald-800', 'Reconocido'],
  sugerido: ['bg-amber-100 text-amber-800', 'Sugerido · revisar'],
  sin_vincular: ['bg-red-100 text-red-700', 'Sin vincular'],
  nuevo: ['bg-sky-100 text-sky-800', 'Producto nuevo'],
  manual: ['bg-stone-100 text-stone-600', 'Elegido'],
}

function FilaCompra({ i, upd, quitar, margen, redondeo, mejor, proveedor, costoUnit, onVincular }: { i: Item; upd: (k: string, c: Partial<Item>) => void; quitar: () => void; margen: number; redondeo: number; mejor?: MejorPrecio; proveedor: string; costoUnit: number | null; onVincular: () => void }) {
  const p = i.producto
  const costo = costoUnit
  const anterior = p?.costo ?? null
  const variacion = costo != null && anterior ? ((costo - anterior) / anterior) * 100 : null
  const precioActual = p?.precio ?? 0
  const margenActual = costo && precioActual ? ((precioActual - costo) / costo) * 100 : null
  const sugerido = costo ? precioSugerido(costo, margen, redondeo) : null
  const conviene = sugerido != null && sugerido > precioActual
  const decision = i.precioNuevo === '' ? 'mantener' : 'cambiar'
  const upb = num(i.upb) || 1
  const desdeFoto = !!(i.descProv || i.codigoProv)

  return (
    <div className={`tarjeta p-3 space-y-2 ${i.estado === 'sin_vincular' ? 'ring-2 ring-red-200' : i.estado === 'sugerido' ? 'ring-2 ring-amber-200' : ''}`}>
      {desdeFoto && (
        <div className="flex items-start gap-2 text-xs text-stone-500">
          <span className="flex-1">En el comprobante: <b className="text-stone-700">{i.descProv}</b>{i.codigoProv && ` · cód. ${i.codigoProv}`}{i.dudoso && <span className="text-red-600 font-semibold"> · ilegible, revisar</span>}</span>
          <span className={`chip ${CHIP[i.estado][0]}`}>{CHIP[i.estado][1]}</span>
        </div>
      )}
      <div className="flex items-start gap-2">
        {p ? (
          <button onClick={onVincular} className="flex-1 text-left font-semibold leading-tight">{p.nombre}<span className="block text-xs font-normal text-stone-500">{p.sku} · stock {n(p.stock)} {desdeFoto && <span className="text-marca underline">cambiar</span>}</span></button>
        ) : (
          <div className="flex-1 space-y-1">
            <button onClick={onVincular} className="btn-secundario w-full py-2 text-sm"><Icono n="buscar" className="w-4 h-4" /> Elegir a qué producto mío corresponde</button>
            {i.estado === 'sin_vincular'
              ? <button onClick={() => upd(i.key, { estado: 'nuevo', nombreNuevo: i.nombreNuevo || i.descProv.toUpperCase() })} className="w-full text-sm text-stone-600 underline py-1">…o es un producto nuevo</button>
              : <input value={i.nombreNuevo} onChange={(e) => upd(i.key, { nombreNuevo: e.target.value })} className="campo" placeholder="Nombre corto del producto nuevo" />}
          </div>
        )}
        <button onClick={quitar} className="p-1 text-stone-400"><Icono n="x" /></button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="etiqueta">Cantidad</label><input value={i.cantidad} onChange={(e) => upd(i.key, { cantidad: e.target.value })} className="campo num" inputMode="decimal" /></div>
        <div><label className="etiqueta">Unid. x bulto</label><input value={i.upb} onChange={(e) => upd(i.key, { upb: e.target.value })} className="campo num" inputMode="decimal" /></div>
        <div><label className="etiqueta">{upb > 1 ? 'Costo x bulto' : 'Costo unit.'}</label><input value={i.costo} onChange={(e) => upd(i.key, { costo: e.target.value })} className="campo num" inputMode="decimal" /></div>
      </div>
      {upb > 1 && <p className="text-xs text-stone-600">Suma <b>{n(unidades(i))} unidades</b> al stock · costo por unidad <b className="num">{$(costo)}</b></p>}

      {costo != null && costo > 0 && (
        <div className={`rounded-xl p-2.5 text-sm ${variacion != null && variacion > 0.5 ? 'bg-red-50' : variacion != null && variacion < -0.5 ? 'bg-emerald-50' : 'bg-stone-50'}`}>
          {p && (
            <div className="flex justify-between">
              <span>Costo anterior <b className="num">{$(anterior)}</b> · nuevo <b className="num">{$(costo)}</b></span>
              {variacion != null && Math.abs(variacion) > 0.05 && (
                <b className={`flex items-center gap-1 ${variacion > 0 ? 'text-red-700' : 'text-emerald-700'}`}><Icono n={variacion > 0 ? 'arriba' : 'abajo'} className="w-4 h-4" />{pct(variacion)}</b>
              )}
            </div>
          )}
          {p && variacion != null && Math.abs(variacion) > 60 && <p className="text-xs text-red-700">¿Seguro? El costo cambió mucho: revisá las unidades por bulto o si es el producto correcto.</p>}
          {p && <div>Precio de venta actual <b className="num">{$(precioActual)}</b> → margen <b className={margenActual != null && margenActual < margen / 2 ? 'text-red-700' : ''}>{pct(margenActual)}</b></div>}
          {mejor && proveedor.trim().toLowerCase() !== mejor.proveedor.toLowerCase() && Number(mejor.precio_proveedor) < costo && (
            <div className="text-amber-800">💡 {mejor.proveedor} lo tiene a <b className="num">{$(mejor.precio_proveedor)}</b> en su lista</div>
          )}
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            {p && <button onClick={() => upd(i.key, { precioNuevo: '' })} className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${decision === 'mantener' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white border-stone-300'}`}>Mantener {$(precioActual)}</button>}
            {sugerido != null && (p ? sugerido !== precioActual : true) && (
              <button onClick={() => upd(i.key, { precioNuevo: String(sugerido) })} className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${i.precioNuevo === String(sugerido) ? 'bg-marca text-white border-marca' : conviene ? 'bg-white border-marca text-marca' : 'bg-white border-stone-300'}`}>
                {p ? (conviene ? 'Aumentar' : 'Bajar') + ' a' : 'Precio'} {$(sugerido)} <span className="opacity-70 font-normal">({margen}%)</span>
              </button>
            )}
            <input value={i.precioNuevo} onChange={(e) => upd(i.key, { precioNuevo: e.target.value })} placeholder="Otro precio" className="campo w-28 py-1.5 num text-sm" inputMode="decimal" />
          </div>
          {p && conviene && decision === 'mantener' && <p className="text-xs text-red-700 mt-1.5">Con este costo, mantener el precio te deja por debajo del {margen}% de margen.</p>}
        </div>
      )}
      {i.estado === 'sugerido' && p && <button onClick={() => upd(i.key, { estado: 'manual' })} className="text-sm text-marca font-semibold">✓ Sí, es este producto</button>}
    </div>
  )
}

function ElegirProducto({ productos, texto, onElegir, onCerrar }: { productos: Producto[]; texto: string; onElegir: (p: Producto | null) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const lista = useMemo(() => (q ? filtrar(productos, q, 30) : [...productos].map((p) => ({ p, s: similitud(texto, p.nombre) })).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.p)), [q, productos, texto])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-fondo rounded-t-3xl max-h-[85vh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-stone-500">En el comprobante dice:</p>
          <h3 className="font-bold mb-2">{texto}</h3>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo mb-2" placeholder="Buscar en mis productos (nombre corto)…" />
          <ul className="tarjeta divide-y divide-stone-100">
            {lista.map((p) => <li key={p.id}><button onClick={() => onElegir(p)} className="w-full text-left px-3 py-2.5">{p.nombre} <span className="text-xs text-stone-500">{p.sku} · costo {$(p.costo)}</span></button></li>)}
          </ul>
          <button onClick={() => onElegir(null)} className="btn-secundario w-full mt-3">Es un producto nuevo (lo creo)</button>
          <p className="text-xs text-stone-500 mt-2">Lo que elijas queda guardado: la próxima factura de este proveedor lo reconoce sola.</p>
        </div>
      </div>
    </div>
  )
}
