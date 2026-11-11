import { useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { useProductosDueno } from '../lib/catalogo'
import { $, fecha, filtrar, hoyISO, norm, parsearPrecio, pct, similitud } from '../lib/formato'
import { adivinarColumnas, leerArchivo, leerTexto } from '../lib/planillas'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Fila = { proveedor: string; producto_id: number; sku: string; nombre: string; costo_actual: number | null; precio_venta: number; precio_proveedor: number; fecha_lista: string; es_mas_barato: boolean; dif_vs_costo_pct: number | null }

export default function Comparador() {
  const [vista, setVista] = useState<'comparar' | 'subir'>('comparar')
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 bg-stone-200/70 rounded-xl p-1">
        {(['comparar', 'subir'] as const).map((v) => (
          <button key={v} onClick={() => setVista(v)} className={`py-2 rounded-lg font-semibold text-sm ${vista === v ? 'bg-white shadow-sm' : 'text-stone-600'}`}>
            {v === 'comparar' ? 'Comparar precios' : 'Subir lista de proveedor'}
          </button>
        ))}
      </div>
      {vista === 'comparar' ? <Comparar /> : <SubirLista onListo={() => setVista('comparar')} />}
    </div>
  )
}

function Comparar() {
  const [filas, setFilas] = useState<Fila[]>([])
  const [q, setQ] = useState('')
  const [soloAhorro, setSoloAhorro] = useState(false)
  const [cargando, setCargando] = useState(true)
  useEffect(() => { supabase.rpc('comparar_precios').then(({ data }) => { setFilas(((data as Fila[]) ?? []).map((f) => ({ ...f, precio_proveedor: Number(f.precio_proveedor), costo_actual: f.costo_actual == null ? null : Number(f.costo_actual) }))); setCargando(false) }) }, [])

  const grupos = useMemo(() => {
    const m = new Map<number, Fila[]>()
    for (const f of filas) m.set(f.producto_id, [...(m.get(f.producto_id) ?? []), f])
    let lista = [...m.values()].map((fs) => ({ p: fs[0], ofertas: fs.sort((a, b) => a.precio_proveedor - b.precio_proveedor) }))
    if (soloAhorro) lista = lista.filter((g) => g.p.costo_actual != null && g.ofertas[0].precio_proveedor < g.p.costo_actual)
    const qq = norm(q)
    if (qq) lista = lista.filter((g) => norm(g.p.nombre + ' ' + g.p.sku).includes(qq))
    return lista
  }, [filas, q, soloAhorro])

  const ahorroTotal = grupos.reduce((s, g) => s + (g.p.costo_actual != null ? Math.max(0, g.p.costo_actual - g.ofertas[0].precio_proveedor) : 0), 0)

  if (cargando) return <p className="text-stone-500">Cargando…</p>
  if (!filas.length) return (
    <div className="tarjeta p-6 text-center text-stone-600">
      <Icono n="balanza" className="w-10 h-10 mx-auto text-stone-400 mb-2" />
      Todavía no hay listas de proveedores cargadas.<br />Subí la primera desde <b>Subir lista de proveedor</b>.
    </div>
  )
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} className="campo" placeholder="Buscar producto…" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloAhorro} onChange={(e) => setSoloAhorro(e.target.checked)} className="w-5 h-5 accent-marca" /> Sólo donde hay un proveedor más barato que mi costo</label>
      {soloAhorro && <p className="text-sm text-emerald-800">Ahorro posible por unidad sumando todo: <b className="num">{$(ahorroTotal)}</b></p>}
      <ul className="space-y-2">
        {grupos.map(({ p, ofertas }) => (
          <li key={p.producto_id} className="tarjeta p-3">
            <div className="flex justify-between gap-2">
              <div className="font-semibold leading-tight">{p.nombre}<span className="block text-xs font-normal text-stone-500">{p.sku} · mi costo {$(p.costo_actual)} · vendo a {$(p.precio_venta)}</span></div>
            </div>
            <div className="mt-2 space-y-1">
              {ofertas.map((o) => {
                const dif = p.costo_actual ? ((o.precio_proveedor - p.costo_actual) / p.costo_actual) * 100 : null
                return (
                  <div key={o.proveedor} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${o.es_mas_barato ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-stone-50'}`}>
                    <span>{o.es_mas_barato && '🏆 '}<b>{o.proveedor}</b> <span className="text-xs text-stone-500">{fecha(o.fecha_lista)}</span></span>
                    <span className="num"><b>{$(o.precio_proveedor)}</b> {dif != null && <span className={dif > 0 ? 'text-red-600' : dif < 0 ? 'text-emerald-700' : 'text-stone-500'}>{pct(dif)}</span>}</span>
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

type Renglon = { desc: string; codigo: string; precio: number | null; producto: Producto | null; score: number; incluir: boolean }

function SubirLista({ onListo }: { onListo: () => void }) {
  const { productos } = useProductosDueno()
  const [proveedores, setProveedores] = useState<string[]>([])
  const [proveedor, setProveedor] = useState('')
  const [dia, setDia] = useState(hoyISO())
  const [crudo, setCrudo] = useState<unknown[][]>([])
  const [cols, setCols] = useState({ desc: -1, precio: -1, codigo: -1, tieneEncabezado: false })
  const [texto, setTexto] = useState('')
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [eligiendo, setEligiendo] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [libro, setLibro] = useState<{ hojas: string[]; filas: (h?: string) => unknown[][] } | null>(null)

  useEffect(() => { supabase.from('proveedores').select('nombre').order('nombre').then(({ data }) => setProveedores((data ?? []).map((p) => p.nombre))) }, [])

  function cargarFilas(f: unknown[][]) {
    setCrudo(f)
    setCols(adivinarColumnas(f))
  }
  async function alArchivo(file?: File) {
    if (!file) return
    try { const l = await leerArchivo(file); setLibro(l); cargarFilas(l.filas()) } catch (e) { setMsg(mensajeError(e)) }
  }

  // emparejar con mis productos
  useEffect(() => {
    if (cols.desc < 0 || cols.precio < 0 || !productos.length) { setRenglones([]); return }
    const datos = crudo.slice(cols.tieneEncabezado ? 1 : 0)
    const porCodigo = new Map(productos.filter((p) => p.codigo_barras).map((p) => [p.codigo_barras!, p]))
    setRenglones(datos.map((f) => {
      const desc = String(f[cols.desc] ?? '').trim()
      const codigo = cols.codigo >= 0 ? String(f[cols.codigo] ?? '').replace(/^\*/, '').trim() : ''
      const precio = parsearPrecio(f[cols.precio])
      let producto: Producto | null = porCodigo.get(codigo) ?? null
      let score = producto ? 1 : 0
      if (!producto && desc) {
        for (const p of productos) { const s = similitud(desc, p.nombre); if (s > score) { score = s; producto = p } }
        if (score < 0.35) producto = null
      }
      return { desc, codigo, precio, producto, score, incluir: !!desc && precio != null && precio > 0 }
    }).filter((r) => r.desc || r.precio))
  }, [crudo, cols, productos])

  async function guardar() {
    if (!proveedor.trim()) { setMsg('Elegí el proveedor'); return }
    const sel = renglones.filter((r) => r.incluir && r.precio != null)
    if (!sel.length) { setMsg('No hay renglones para guardar'); return }
    setGuardando(true); setMsg('')
    const { data: prov, error: e1 } = await supabase.from('proveedores').upsert({ nombre: proveedor.trim() }, { onConflict: 'nombre' }).select('id').single()
    if (e1) { setGuardando(false); setMsg(mensajeError(e1)); return }
    const { error } = await supabase.from('precios_proveedor').insert(sel.map((r) => ({
      proveedor_id: prov.id, producto_id: r.producto?.id ?? null, codigo_proveedor: r.codigo || null, descripcion: r.desc, precio: r.precio, fecha_lista: dia,
    })))
    setGuardando(false)
    if (error) { setMsg(mensajeError(error)); return }
    alert(`Lista guardada: ${sel.length} precios de ${proveedor} (${sel.filter((r) => r.producto).length} vinculados a tus productos).`)
    onListo()
  }

  const ncols = Math.max(0, ...crudo.slice(0, 20).map((f) => f.length))
  const nombreCol = (c: number) => (cols.tieneEncabezado ? String(crudo[0]?.[c] ?? '') : '') || `Columna ${String.fromCharCode(65 + c)}`

  return (
    <div className="space-y-3">
      <div className="tarjeta p-3 space-y-2">
        <div>
          <label className="etiqueta">Proveedor</label>
          <input list="provs2" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="campo" placeholder="Nombre del proveedor" />
          <datalist id="provs2">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div><label className="etiqueta">Fecha de la lista</label><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="campo" /></div>
      </div>

      {!crudo.length && (
        <div className="tarjeta p-3 space-y-3">
          <label className="btn-primario w-full py-3 cursor-pointer"><Icono n="subir" /> Subir Excel o CSV<input type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden" onChange={(e) => alArchivo(e.target.files?.[0])} /></label>
          <div className="text-center text-sm text-stone-500">o pegá la lista (copiada de WhatsApp, PDF o mail)</div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className="campo font-mono text-sm" placeholder={'LAVANDINA AYUDIN 1L   $1.250\nDETERGENTE MAGISTRAL 500   2.890'} />
          <button onClick={() => cargarFilas(leerTexto(texto))} disabled={!texto.trim()} className="btn-secundario w-full">Leer lista pegada</button>
        </div>
      )}

      {crudo.length > 0 && (
        <>
          <div className="tarjeta p-3 space-y-2">
            {libro && libro.hojas.length > 1 && (
              <div><label className="etiqueta">Hoja</label><select onChange={(e) => cargarFilas(libro.filas(e.target.value))} className="campo">{libro.hojas.map((h) => <option key={h}>{h}</option>)}</select></div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(['desc', 'precio', 'codigo'] as const).map((k) => (
                <div key={k}>
                  <label className="etiqueta">{k === 'desc' ? 'Descripción' : k === 'precio' ? 'Precio' : 'Código (opc.)'}</label>
                  <select value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: Number(e.target.value) })} className="campo px-2 text-sm">
                    <option value={-1}>—</option>
                    {Array.from({ length: ncols }, (_, c) => <option key={c} value={c}>{nombreCol(c)}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cols.tieneEncabezado} onChange={(e) => setCols({ ...cols, tieneEncabezado: e.target.checked })} className="w-5 h-5 accent-marca" /> La primera fila son títulos</label>
            <button onClick={() => { setCrudo([]); setLibro(null) }} className="text-sm text-stone-500 underline">Empezar de nuevo</button>
          </div>

          <div className="text-sm text-stone-600">{renglones.filter((r) => r.incluir).length} precios · {renglones.filter((r) => r.incluir && r.producto).length} vinculados a tus productos. Tocá un renglón para corregir el vínculo.</div>
          <ul className="tarjeta divide-y divide-stone-100">
            {renglones.map((r, i) => (
              <li key={i} className={`px-3 py-2 text-sm ${r.incluir ? '' : 'opacity-40'}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={r.incluir} onChange={(e) => setRenglones((rs) => rs.map((x, j) => (j === i ? { ...x, incluir: e.target.checked } : x)))} className="mt-0.5 w-4 h-4 accent-marca" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{r.desc || <i>sin descripción</i>}</div>
                    <button onClick={() => setEligiendo(i)} className={`text-xs ${r.producto ? (r.score > 0.6 ? 'text-emerald-700' : 'text-amber-700') : 'text-stone-500'}`}>
                      {r.producto ? `→ ${r.producto.nombre} (costo ${$(r.producto.costo)})` : '→ sin vincular (tocar para elegir)'}
                    </button>
                  </div>
                  <b className="num">{$(r.precio)}</b>
                </div>
              </li>
            ))}
          </ul>
          {msg && <p className="text-red-600">{msg}</p>}
          <button onClick={guardar} disabled={guardando} className="btn-primario w-full py-3.5">{guardando ? 'Guardando…' : 'Guardar lista y comparar'}</button>
        </>
      )}

      {eligiendo != null && (
        <ElegirProducto productos={productos} sugerencia={renglones[eligiendo].desc}
          onElegir={(p) => { setRenglones((rs) => rs.map((x, j) => (j === eligiendo ? { ...x, producto: p, score: 1 } : x))); setEligiendo(null) }}
          onCerrar={() => setEligiendo(null)} />
      )}
    </div>
  )
}

function ElegirProducto({ productos, sugerencia, onElegir, onCerrar }: { productos: Producto[]; sugerencia: string; onElegir: (p: Producto | null) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const lista = useMemo(() => (q ? filtrar(productos, q, 30) : [...productos].map((p) => ({ p, s: similitud(sugerencia, p.nombre) })).sort((a, b) => b.s - a.s).slice(0, 15).map((x) => x.p)), [q, productos, sugerencia])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-fondo rounded-t-3xl max-h-[85vh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-stone-500">Lista del proveedor:</p>
          <h3 className="font-bold mb-2">{sugerencia}</h3>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo mb-2" placeholder="Buscar en mis productos…" />
          <ul className="tarjeta divide-y divide-stone-100">
            {lista.map((p) => <li key={p.id}><button onClick={() => onElegir(p)} className="w-full text-left px-3 py-2.5">{p.nombre} <span className="text-xs text-stone-500">{p.sku}</span></button></li>)}
          </ul>
          <button onClick={() => onElegir(null)} className="btn-secundario w-full mt-3">No es ninguno de mis productos</button>
        </div>
      </div>
    </div>
  )
}
