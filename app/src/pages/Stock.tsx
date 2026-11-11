import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import Icono from '../components/Icono'
import { useCatalogo, useConfig, useProductosDueno } from '../lib/catalogo'
import { $, fechaHora, filtrar, n, pct, precioSugerido } from '../lib/formato'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Filtro = 'todos' | 'reponer' | 'negativo' | 'sin_precio' | 'margen'

export default function Stock() {
  const { esDueno } = useAuth()
  return esDueno ? <StockDueno /> : <StockEmpleado />
}

function Filtros({ filtro, setFiltro, conteos, dueno }: { filtro: Filtro; setFiltro: (f: Filtro) => void; conteos: Record<Filtro, number>; dueno: boolean }) {
  const ops: [Filtro, string][] = [['todos', 'Todos'], ['reponer', 'A reponer'], ['negativo', 'Stock negativo'], ...(dueno ? ([['sin_precio', 'Sin precio/costo'], ['margen', 'Margen bajo']] as [Filtro, string][]) : [])]
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 no-scrollbar">
      {ops.map(([f, t]) => (
        <button key={f} onClick={() => setFiltro(f)} className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold border ${filtro === f ? 'bg-marca text-white border-marca' : 'bg-white border-stone-300 text-stone-700'}`}>
          {t} <span className="opacity-70">{conteos[f]}</span>
        </button>
      ))}
    </div>
  )
}

function aplicar(ps: Producto[], f: Filtro, margenMin: number) {
  switch (f) {
    case 'reponer': return ps.filter((p) => p.stock <= p.stock_minimo)
    case 'negativo': return ps.filter((p) => p.stock < 0)
    case 'sin_precio': return ps.filter((p) => !(p.precio > 0) || !(Number(p.costo) > 0))
    case 'margen': return ps.filter((p) => Number(p.costo) > 0 && p.precio > 0 && ((p.precio - Number(p.costo)) / Number(p.costo)) * 100 < margenMin)
    default: return ps
  }
}

function StockEmpleado() {
  const { productos, cargando, recargar } = useCatalogo()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const conteos = useMemo(() => Object.fromEntries((['todos', 'reponer', 'negativo', 'sin_precio', 'margen'] as Filtro[]).map((f) => [f, aplicar(productos, f, 0).length])) as Record<Filtro, number>, [productos])
  const lista = useMemo(() => filtrar(aplicar(productos, filtro, 0), q, 500), [productos, filtro, q])
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="campo" />
        <button onClick={recargar} className="btn-secundario" disabled={cargando}>{cargando ? '…' : 'Actualizar'}</button>
      </div>
      <Filtros filtro={filtro} setFiltro={setFiltro} conteos={conteos} dueno={false} />
      <ul className="tarjeta divide-y divide-stone-100">
        {lista.map((p) => (
          <li key={p.id} className="px-3 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.nombre}</div><div className="text-xs text-stone-500">{p.sku}</div></div>
            <div className="text-right"><div className="font-bold num">{$(p.precio)}</div><StockChip p={p} /></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StockChip({ p }: { p: Producto }) {
  const c = p.stock < 0 ? 'bg-red-100 text-red-700' : p.stock <= p.stock_minimo ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
  return <span className={`chip ${c} num`}>{n(p.stock)} u.</span>
}

function StockDueno() {
  const { productos, setProductos, cargando, recargar } = useProductosDueno()
  const { config } = useConfig()
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null)
  const margenMin = config.margen_objetivo * 0.5

  const conteos = useMemo(() => Object.fromEntries((['todos', 'reponer', 'negativo', 'sin_precio', 'margen'] as Filtro[]).map((f) => [f, aplicar(productos, f, margenMin).length])) as Record<Filtro, number>, [productos, margenMin])
  const lista = useMemo(() => filtrar(aplicar(productos, filtro, margenMin), q, 1000), [productos, filtro, q, margenMin])
  const valor = useMemo(() => productos.reduce((a, p) => ({ costo: a.costo + Math.max(p.stock, 0) * (Number(p.costo) || 0), venta: a.venta + Math.max(p.stock, 0) * p.precio }), { costo: 0, venta: 0 }), [productos])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="tarjeta p-3"><div className="etiqueta">Stock a costo</div><div className="text-lg font-bold num">{$(valor.costo)}</div></div>
        <div className="tarjeta p-3"><div className="etiqueta">Stock a venta</div><div className="text-lg font-bold num">{$(valor.venta)}</div></div>
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="campo" />
        <button onClick={() => setEditando('nuevo')} className="btn-primario px-3" aria-label="Nuevo producto"><Icono n="sumar" /></button>
      </div>
      <Filtros filtro={filtro} setFiltro={setFiltro} conteos={conteos} dueno />
      {cargando && <p className="text-stone-500 text-sm">Cargando…</p>}
      <ul className="tarjeta divide-y divide-stone-100">
        {lista.map((p) => {
          const m = Number(p.costo) > 0 ? ((p.precio - Number(p.costo)) / Number(p.costo)) * 100 : null
          return (
            <li key={p.id}>
              <button onClick={() => setEditando(p)} className={`w-full text-left px-3 py-2.5 flex items-center gap-3 ${p.activo === false ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.nombre}</div>
                  <div className="text-xs text-stone-500 flex gap-2 flex-wrap">
                    <span>{p.sku}</span><span>Costo {$(p.costo)}</span>
                    <span className={m == null ? '' : m < 0 ? 'text-red-600 font-semibold' : m < margenMin ? 'text-amber-600 font-semibold' : 'text-emerald-700'}>Margen {pct(m)}</span>
                    {p.codigo_barras && <span title="Tiene código de barras">▮▮</span>}
                  </div>
                </div>
                <div className="text-right"><div className="font-bold num">{$(p.precio)}</div><StockChip p={p} /></div>
              </button>
            </li>
          )
        })}
      </ul>
      <button onClick={recargar} className="btn-secundario w-full">Actualizar</button>

      {editando && (
        <EditarProducto producto={editando === 'nuevo' ? null : editando} margen={config.margen_objetivo} redondeo={config.redondeo}
          onCerrar={() => setEditando(null)}
          onGuardado={(p) => { setProductos((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p].sort((a, b) => a.nombre.localeCompare(b.nombre)))); setEditando(null) }} />
      )}
    </div>
  )
}

type Hist = { fecha: string; costo_anterior: number | null; costo_nuevo: number | null; precio_anterior: number | null; precio_nuevo: number | null; motivo: string }

function EditarProducto({ producto, margen, redondeo, onCerrar, onGuardado }: { producto: Producto | null; margen: number; redondeo: number; onCerrar: () => void; onGuardado: (p: Producto) => void }) {
  const [f, setF] = useState({
    nombre: producto?.nombre ?? '', sku: producto?.sku ?? '', codigo_barras: producto?.codigo_barras ?? '',
    costo: producto?.costo?.toString() ?? '', precio: producto?.precio?.toString() ?? '',
    stock: producto?.stock?.toString() ?? '0', stock_minimo: producto?.stock_minimo?.toString() ?? '2', activo: producto?.activo ?? true,
  })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [hist, setHist] = useState<Hist[]>([])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const costo = num(f.costo), precio = num(f.precio)
  const sugerido = costo ? precioSugerido(costo, margen, redondeo) : null
  const m = costo && precio ? ((precio - costo) / costo) * 100 : null

  useEffect(() => {
    if (!producto) return
    supabase.from('historial_precios').select('fecha,costo_anterior,costo_nuevo,precio_anterior,precio_nuevo,motivo').eq('producto_id', producto.id).order('fecha', { ascending: false }).limit(10)
      .then(({ data }) => setHist((data as Hist[]) ?? []))
  }, [producto])

  async function guardar() {
    if (!f.nombre.trim()) { setError('Falta el nombre'); return }
    setGuardando(true); setError('')
    let sku = f.sku.trim().toUpperCase()
    if (!sku) { const { data } = await supabase.rpc('nuevo_sku', { p_nombre: f.nombre }); sku = data as string }
    const fila = {
      nombre: f.nombre.trim().toUpperCase(), sku, codigo_barras: f.codigo_barras.trim() || null,
      costo, precio: precio ?? 0, stock: num(f.stock) ?? 0, stock_minimo: num(f.stock_minimo) ?? 2, activo: f.activo,
    }
    const r = producto
      ? await supabase.from('productos').update(fila).eq('id', producto.id).select().single()
      : await supabase.from('productos').insert(fila).select().single()
    setGuardando(false)
    if (r.error) { setError(/duplicate|unique/i.test(r.error.message) ? 'Ese SKU o código de barras ya existe' : mensajeError(r.error)); return }
    const p = r.data as Producto
    onGuardado({ ...p, precio: Number(p.precio), stock: Number(p.stock), stock_minimo: Number(p.stock_minimo), costo: p.costo == null ? null : Number(p.costo) })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-fondo rounded-t-3xl max-h-[92vh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold">{producto ? 'Editar producto' : 'Producto nuevo'}</h2>
            <button onClick={onCerrar} className="p-2 rounded-full bg-white border border-stone-200"><Icono n="x" /></button>
          </div>
          <div><label className="etiqueta">Nombre</label><input value={f.nombre} onChange={set('nombre')} className="campo" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="etiqueta">SKU</label><input value={f.sku} onChange={set('sku')} className="campo" placeholder="Automático" /></div>
            <div><label className="etiqueta">Código de barras</label><input value={f.codigo_barras} onChange={set('codigo_barras')} className="campo" inputMode="numeric" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="etiqueta">Costo</label><input value={f.costo} onChange={set('costo')} className="campo num" inputMode="decimal" /></div>
            <div><label className="etiqueta">Precio de venta</label><input value={f.precio} onChange={set('precio')} className="campo num" inputMode="decimal" /></div>
          </div>
          {sugerido != null && (
            <div className="flex items-center justify-between text-sm bg-white rounded-xl border border-stone-200 px-3 py-2">
              <span>Margen actual <b className={m != null && m < margen / 2 ? 'text-red-600' : ''}>{pct(m)}</b> · Sugerido con {margen}%: <b className="num">{$(sugerido)}</b></span>
              <button onClick={() => setF({ ...f, precio: String(sugerido) })} className="text-marca font-semibold">Usar</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="etiqueta">Stock actual</label><input value={f.stock} onChange={set('stock')} className="campo num" inputMode="decimal" /></div>
            <div><label className="etiqueta">Stock mínimo</label><input value={f.stock_minimo} onChange={set('stock_minimo')} className="campo num" inputMode="decimal" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} className="w-5 h-5 accent-marca" /> Activo (aparece para vender)</label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button onClick={guardar} disabled={guardando} className="btn-primario w-full py-3">{guardando ? 'Guardando…' : 'Guardar'}</button>

          {hist.length > 0 && (
            <div>
              <div className="etiqueta mt-2">Historial de precios</div>
              <ul className="tarjeta divide-y divide-stone-100 text-sm">
                {hist.map((h, i) => (
                  <li key={i} className="px-3 py-2 flex justify-between gap-2">
                    <span className="text-stone-500">{fechaHora(h.fecha)} · {h.motivo}</span>
                    <span className="num text-right">
                      {h.costo_anterior !== h.costo_nuevo && <>Costo {$(h.costo_anterior)} → <b>{$(h.costo_nuevo)}</b><br /></>}
                      {h.precio_anterior !== h.precio_nuevo && <>Precio {$(h.precio_anterior)} → <b>{$(h.precio_nuevo)}</b></>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
