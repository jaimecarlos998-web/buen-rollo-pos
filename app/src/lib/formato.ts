const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const pesos2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

export const $ = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? '—' : pesos.format(Number(n)))
export const $2 = (n: number | null | undefined) => (n == null || isNaN(Number(n)) ? '—' : pesos2.format(Number(n)))
export const n = (x: number | null | undefined) => (x == null ? '—' : numero.format(Number(x)))
export const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${numero.format(Math.round(x * 10) / 10)}%`)

export function fechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
}
export function fecha(iso: string) {
  const d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
}
export function hoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

/** Normaliza texto para buscar: sin acentos, mayúsculas, espacios simples */
export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Busca productos por palabras (todas deben aparecer en nombre, SKU o código) */
export function filtrar<T extends { nombre: string; sku: string; codigo_barras?: string | null }>(lista: T[], q: string, max = 60): T[] {
  const palabras = norm(q).split(' ').filter(Boolean)
  if (!palabras.length) return lista.slice(0, max)
  const out: T[] = []
  for (const p of lista) {
    const h = norm(`${p.nombre} ${p.sku} ${p.codigo_barras ?? ''}`)
    if (palabras.every((w) => h.includes(w))) out.push(p)
    if (out.length >= max) break
  }
  return out
}

/** Precio sugerido = costo × (1 + margen%), redondeado hacia arriba */
export function precioSugerido(costo: number, margen: number, redondeo: number) {
  const bruto = costo * (1 + margen / 100)
  const r = redondeo > 0 ? redondeo : 1
  return Math.ceil(bruto / r) * r
}

/** Similitud por trigramas (0..1), como pg_trgm, para emparejar nombres de listas de proveedores */
function trigramas(s: string) {
  const out = new Set<string>()
  for (const w of norm(s).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(Boolean)) {
    const p = `  ${w} `
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3))
  }
  return out
}
export function similitud(a: string, b: string) {
  const A = trigramas(a), B = trigramas(b)
  if (!A.size || !B.size) return 0
  let c = 0
  A.forEach((t) => { if (B.has(t)) c++ })
  return c / (A.size + B.size - c)
}

/** Convierte "$ 1.234,50" / "1234.5" / "1,234.50" a número */
export function parsearPrecio(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (v == null) return null
  let s = String(v).replace(/[^\d.,-]/g, '')
  if (!s) return null
  const lc = s.lastIndexOf(','), lp = s.lastIndexOf('.')
  if (lc > lp) s = s.replace(/\./g, '').replace(',', '.')          // 1.234,50
  else if (lp > lc && lc >= 0) s = s.replace(/,/g, '')              // 1,234.50
  else if (lc === -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // 12.500
  const x = Number(s)
  return isFinite(x) ? x : null
}
