import { useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { useConfig, useProductosDueno } from '../lib/catalogo'
import { $, fecha, filtrar, hoyISO, n, pct, precioSugerido } from '../lib/formato'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Item = {
  key: string
  producto: Producto | null      // null = producto nuevo
  nombreNuevo: string
  cantidad: string
  costo: string
  precioNuevo: string            // '' = mantener precio actual
}
type CompraHist = { id: number; fecha: string; nro_comprobante: string | null; total: number; origen: string; proveedores: { nombre: string } | null; compra_items: { nombre: string; cantidad: number; costo_unit: number; costo_anterior: number | null }[] }
type MejorPrecio = { producto_id: number; proveedor: string; precio_proveedor: number; es_mas_barato: boolean }

const num = (s: string) => { const x = Number(s.replace(/\s/g, '').replace(',', '.')); return s.trim() === '' || isNaN(x) ? null : x }

export default function Compras() {
  const { productos, recargar } = useProductosDueno()
  const { config } = useConfig()
  const [proveedores, setProveedores] = useState<string[]>([])
  const [proveedor, setProveedor] = useState('')
  const [nro, setNro] = useState('')
  const [dia, setDia] = useState(hoyISO())
  const [items, setItems] = useState<Item[]>([])
  const [buscando, setBuscando] = useState(false)
  const [q, setQ] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [historial, setHistorial] = useState<CompraHist[]>([])
  const [mejores, setMejores] = useState<Record<number, MejorPrecio>>({})
  const [abierta, setAbierta] = useState<number | null>(null)

  async function cargarHist() {
    const { data } = await supabase.from('compras').select('id,fecha,nro_comprobante,total,origen,proveedores(nombre),compra_items(nombre,cantidad,costo_unit,costo_anterior)').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(30)
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

  function agregar(p: Producto | null) {
    setItems((it) => [...it, { key: crypto.randomUUID?.() ?? String(Math.random()), producto: p, nombreNuevo: p ? '' : q.toUpperCase(), cantidad: '1', costo: p?.costo ? String(p.costo) : '', precioNuevo: '' }])
    setBuscando(false); setQ('')
  }
  const upd = (key: string, cambios: Partial<Item>) => setItems((it) => it.map((i) => (i.key === key ? { ...i, ...cambios } : i)))

  const total = items.reduce((s, i) => s + (num(i.cantidad) ?? 0) * (num(i.costo) ?? 0), 0)

  async function registrar() {
    setMsg(null)
    for (const i of items) {
      if (!(num(i.cantidad)! > 0) || num(i.costo) == null) { setMsg({ ok: false, t: `Revisá cantidad y costo de ${i.producto?.nombre ?? i.nombreNuevo}` }); return }
      if (!i.producto && !i.nombreNuevo.trim()) { setMsg({ ok: false, t: 'Hay un producto nuevo sin nombre' }); return }
    }
    setGuardando(true)
    const { error } = await supabase.rpc('registrar_compra', {
      p_proveedor: proveedor, p_nro_comprobante: nro || null, p_fecha: dia,
      p_items: items.map((i) => ({
        producto_id: i.producto?.id ?? null, nombre: i.producto?.nombre ?? i.nombreNuevo,
        cantidad: num(i.cantidad), costo: num(i.costo), precio_nuevo: num(i.precioNuevo),
      })),
    })
    setGuardando(false)
    if (error) { setMsg({ ok: false, t: mensajeError(error) }); return }
    const subieron = items.filter((i) => num(i.precioNuevo) != null).length
    setMsg({ ok: true, t: `Compra registrada por ${$(total)}. Stock actualizado${subieron ? ` y ${subieron} precio(s) cambiados` : ''}.` })
    setItems([]); setNro('')
    recargar(); cargarHist()
  }

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
      </div>

      {items.map((i) => <FilaCompra key={i.key} i={i} upd={upd} quitar={() => setItems((it) => it.filter((x) => x.key !== i.key))} margen={config.margen_objetivo} redondeo={config.redondeo} mejor={i.producto ? mejores[i.producto.id] : undefined} proveedor={proveedor} />)}

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
        <button onClick={() => setBuscando(true)} className="btn-secundario w-full border-dashed py-3"><Icono n="sumar" /> Agregar producto</button>
      )}

      {items.length > 0 && (
        <div className="tarjeta p-4">
          <div className="flex justify-between items-center mb-3"><span className="text-stone-500">Total compra</span><span className="text-2xl font-extrabold num">{$(total)}</span></div>
          <button onClick={registrar} disabled={guardando} className="btn-primario w-full py-3.5">{guardando ? 'Guardando…' : 'Registrar compra'}</button>
        </div>
      )}
      {msg && <p className={`rounded-xl px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}

      <h2 className="text-lg font-bold pt-2">Últimas compras</h2>
      <ul className="tarjeta divide-y divide-stone-100">
        {historial.map((c) => (
          <li key={c.id}>
            <button onClick={() => setAbierta(abierta === c.id ? null : c.id)} className="w-full text-left px-3 py-2.5 flex justify-between gap-2">
              <span><b>{c.proveedores?.nombre ?? 'Sin proveedor'}</b><span className="block text-xs text-stone-500">{fecha(c.fecha)} · {c.compra_items.length} prod.{c.nro_comprobante ? ` · ${c.nro_comprobante}` : ''}{c.origen === 'sheets' ? ' · desde Sheets' : ''}</span></span>
              <span className="font-bold num">{$(c.total)}</span>
            </button>
            {abierta === c.id && (
              <div className="px-3 pb-3 text-sm">
                {c.compra_items.map((it, k) => {
                  const v = it.costo_anterior ? ((it.costo_unit - it.costo_anterior) / it.costo_anterior) * 100 : null
                  return <div key={k} className="flex justify-between gap-2 py-0.5"><span>{n(it.cantidad)} × {it.nombre}</span><span className="num">{$(it.costo_unit)} {v ? <span className={v > 0 ? 'text-red-600' : 'text-emerald-700'}>{pct(v)}</span> : null}</span></div>
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilaCompra({ i, upd, quitar, margen, redondeo, mejor, proveedor }: { i: Item; upd: (k: string, c: Partial<Item>) => void; quitar: () => void; margen: number; redondeo: number; mejor?: MejorPrecio; proveedor: string }) {
  const p = i.producto
  const costo = num(i.costo)
  const anterior = p?.costo ?? null
  const variacion = costo != null && anterior ? ((costo - anterior) / anterior) * 100 : null
  const precioActual = p?.precio ?? 0
  const margenActual = costo && precioActual ? ((precioActual - costo) / costo) * 100 : null
  const sugerido = costo ? precioSugerido(costo, margen, redondeo) : null
  const conviene = sugerido != null && sugerido > precioActual
  const decision = i.precioNuevo === '' ? 'mantener' : 'cambiar'

  return (
    <div className="tarjeta p-3 space-y-2">
      <div className="flex items-start gap-2">
        {p ? <div className="flex-1 font-semibold leading-tight">{p.nombre}<span className="block text-xs font-normal text-stone-500">{p.sku} · stock {n(p.stock)}</span></div>
          : <input value={i.nombreNuevo} onChange={(e) => upd(i.key, { nombreNuevo: e.target.value })} className="campo flex-1" placeholder="Nombre del producto nuevo" />}
        <button onClick={quitar} className="p-1 text-stone-400"><Icono n="x" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="etiqueta">Cantidad</label><input value={i.cantidad} onChange={(e) => upd(i.key, { cantidad: e.target.value })} className="campo num" inputMode="decimal" /></div>
        <div><label className="etiqueta">Costo unitario</label><input value={i.costo} onChange={(e) => upd(i.key, { costo: e.target.value })} className="campo num" inputMode="decimal" /></div>
      </div>

      {costo != null && costo > 0 && (
        <div className={`rounded-xl p-2.5 text-sm ${variacion != null && variacion > 0.5 ? 'bg-red-50' : variacion != null && variacion < -0.5 ? 'bg-emerald-50' : 'bg-stone-50'}`}>
          {p && (
            <div className="flex justify-between">
              <span>Costo anterior <b className="num">{$(anterior)}</b></span>
              {variacion != null && Math.abs(variacion) > 0.05 && (
                <b className={`flex items-center gap-1 ${variacion > 0 ? 'text-red-700' : 'text-emerald-700'}`}><Icono n={variacion > 0 ? 'arriba' : 'abajo'} className="w-4 h-4" />{pct(variacion)}</b>
              )}
            </div>
          )}
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
    </div>
  )
}
