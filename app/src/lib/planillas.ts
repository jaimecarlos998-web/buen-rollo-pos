import * as XLSX from 'xlsx'

/** Lee un Excel/CSV a filas (matriz de celdas), tomando la hoja indicada o la primera */
export async function leerArchivo(file: File): Promise<{ hojas: string[]; filas: (hoja?: string) => unknown[][] }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  return {
    hojas: wb.SheetNames,
    filas: (hoja) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja ?? wb.SheetNames[0]], { header: 1, defval: '', raw: true, blankrows: false }),
  }
}

/** Texto pegado (de WhatsApp, PDF, etc.) a filas: separa por tab, ; o 2+ espacios. Si no, separa el último número como precio. */
export function leerTexto(t: string): unknown[][] {
  const lineas = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lineas.map((l) => {
    if (l.includes('\t')) return l.split('\t')
    if (l.includes(';')) return l.split(';')
    const partes = l.split(/\s{2,}/)
    if (partes.length > 1) return partes
    const m = l.match(/^(.*?)[\s:$-]*\$?\s*([\d.,]+)\s*$/)
    return m ? [m[1], m[2]] : [l]
  })
}

/** Adivina qué columna es descripción, precio y código según los encabezados o el contenido */
export function adivinarColumnas(filas: unknown[][]) {
  const head = (filas[0] ?? []).map((c) => String(c).toLowerCase())
  const busca = (re: RegExp) => head.findIndex((h) => re.test(h))
  let desc = busca(/desc|detalle|producto|art[ií]culo|nombre/)
  let precio = busca(/precio|p\.? ?unit|importe|valor|costo|\$/)
  const codigo = busca(/c[oó]d|ean|barra|sku/)
  const tieneEncabezado = desc >= 0 || precio >= 0
  const datos = filas.slice(tieneEncabezado ? 1 : 0, 30)
  const ncols = Math.max(...filas.slice(0, 30).map((f) => f.length), 0)
  if (desc < 0) {
    let mejor = -1, largo = 0
    for (let c = 0; c < ncols; c++) {
      const l = datos.reduce((s, f) => s + (typeof f[c] === 'string' && isNaN(Number(f[c])) ? String(f[c]).length : 0), 0)
      if (l > largo) { largo = l; mejor = c }
    }
    desc = mejor
  }
  if (precio < 0) {
    for (let c = ncols - 1; c >= 0; c--) {
      if (c === desc) continue
      const nums = datos.filter((f) => f[c] !== '' && !isNaN(Number(String(f[c]).replace(/[$.\s]/g, '').replace(',', '.')))).length
      if (nums >= datos.length * 0.6) { precio = c; break }
    }
  }
  return { desc, precio, codigo, tieneEncabezado }
}

// ───────────── Comprobantes de compra en Excel ─────────────
export type CampoComprobante = 'codigo' | 'cantidad' | 'descripcion' | 'precio' | 'descuento' | 'total'
export type TablaDetectada = { fila: number; columnas: Partial<Record<CampoComprobante, number>>; titulo: string }
export type RenglonComprobante = { codigo: string; descripcion: string; cantidad: number; precio_unitario: number; total: number | null }

const PATRONES: [CampoComprobante, RegExp][] = [
  ['codigo', /^(c[oó]d(igo)?|ean|art(\.|[ií]culo)?|sku|cod\.?)\b/i],
  ['cantidad', /^(cant(idad)?|cant\.|unid(ades)?|u\.?)\b/i],
  ['descripcion', /^(desc(ripci[oó]n)?|detalle|producto|art[ií]culo|nombre)\b/i],
  ['precio', /^(p(recio)?\.? ?unit|precio|p\. ?u\.?|valor unit|costo)/i],
  ['descuento', /^(desc(uento|\.)?\s*%?$|dto|bonif)/i],
  ['total', /^(precio total|total|importe|subtotal|monto)/i],
]

function campoDe(celda: unknown): CampoComprobante | null {
  const t = String(celda ?? '').trim()
  if (!t || t.length > 30) return null
  // "Descuento" no debe confundirse con "Descripción"
  if (/^desc(uento)?$/i.test(t) || /^dto/i.test(t) || /^bonif/i.test(t)) return 'descuento'
  for (const [c, re] of PATRONES) if (re.test(t)) return c
  return null
}

/** Busca tablas de comprobante en la hoja: filas de encabezado con al menos descripción + cantidad/precio.
 *  Una misma fila puede tener dos tablas lado a lado (separadas por columnas vacías). */
export function detectarTablas(filas: unknown[][]): TablaDetectada[] {
  const tablas: TablaDetectada[] = []
  for (let r = 0; r < Math.min(filas.length, 40); r++) {
    const fila = filas[r] ?? []
    let actual: Partial<Record<CampoComprobante, number>> = {}
    let vacias = 0
    const cerrar = () => {
      if (actual.descripcion != null && (actual.cantidad != null || actual.precio != null || actual.total != null)) {
        const titulo = Object.entries(actual).sort((a, b) => a[1]! - b[1]!).map(([k]) => k).join(' · ')
        tablas.push({ fila: r, columnas: actual, titulo })
      }
      actual = {}
    }
    for (let c = 0; c <= fila.length; c++) {
      let campo = c < fila.length ? campoDe(fila[c]) : null
      if (campo === 'precio' && /total/i.test(String(fila[c]))) campo = 'total' // "Precio Total"
      if (campo) {
        if (actual[campo] != null) { cerrar() }
        actual[campo] = c
        vacias = 0
      } else if (Object.keys(actual).length) {
        if (++vacias >= 2) { cerrar(); vacias = 0 }
      }
    }
    cerrar()
  }
  return tablas
}

const aNumero = (v: unknown): number | null => {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v ?? '').replace(/[^\d.,-]/g, '')
  if (!s) return null
  let t = s
  const lc = t.lastIndexOf(','), lp = t.lastIndexOf('.')
  if (lc > lp) t = t.replace(/\./g, '').replace(',', '.')
  else if (lp > lc && lc >= 0) t = t.replace(/,/g, '')
  const x = Number(t)
  return isFinite(x) ? x : null
}

/** Lee los renglones de una tabla detectada hasta un "Subtotal/Total" o varias filas vacías seguidas */
export function leerRenglones(filas: unknown[][], tabla: TablaDetectada): RenglonComprobante[] {
  const col = tabla.columnas
  const out: RenglonComprobante[] = []
  let vacias = 0
  for (let r = tabla.fila + 1; r < filas.length; r++) {
    const f = filas[r] ?? []
    const celdas = Object.values(col).map((c) => f[c!])
    if (celdas.every((v) => v === '' || v == null)) { if (++vacias >= 4) break; continue }
    vacias = 0
    if (celdas.some((v) => /^(sub)?total|^descuento$|^iva|^percep/i.test(String(v ?? '').trim()))) break
    const descripcion = String(col.descripcion != null ? f[col.descripcion] ?? '' : '').replace(/^\*/, '').trim()
    let codigo = col.codigo != null ? String(f[col.codigo] ?? '').trim() : ''
    codigo = codigo.replace(/^\*/, '').replace(/\.0+$/, '')
    const cantidad = col.cantidad != null ? aNumero(f[col.cantidad]) : 1
    let precio = col.precio != null ? aNumero(f[col.precio]) : null
    const total = col.total != null ? aNumero(f[col.total]) : null
    const desc = col.descuento != null ? aNumero(f[col.descuento]) ?? 0 : 0
    if (!descripcion && !codigo) continue
    if (precio == null && total != null && cantidad) precio = total / cantidad
    if (precio != null && desc > 0) precio = desc <= 100 ? precio * (1 - desc / 100) : precio - desc / (cantidad || 1)
    if (precio == null || !cantidad) continue
    out.push({ codigo, descripcion, cantidad, precio_unitario: Math.round(precio * 1000) / 1000, total })
  }
  return out
}
