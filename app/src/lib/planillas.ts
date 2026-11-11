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
