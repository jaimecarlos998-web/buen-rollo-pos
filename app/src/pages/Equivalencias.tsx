import { useEffect, useMemo, useState } from 'react'
import Icono from '../components/Icono'
import { useProductosDueno } from '../lib/catalogo'
import { filtrar, norm } from '../lib/formato'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Eq = { id: number; codigo_proveedor: string | null; descripcion_proveedor: string; producto_id: number; unidades_por_bulto: number; proveedores: { nombre: string } }

/** Cómo llama cada proveedor a mis productos (se aprende sola al cargar facturas) */
export default function Equivalencias() {
  const { productos } = useProductosDueno()
  const [eqs, setEqs] = useState<Eq[]>([])
  const [prov, setProv] = useState('')
  const [q, setQ] = useState('')
  const [editando, setEditando] = useState<Eq | null>(null)

  const cargar = () => supabase.from('equivalencias').select('id,codigo_proveedor,descripcion_proveedor,producto_id,unidades_por_bulto,proveedores!inner(nombre)').order('descripcion_proveedor').then(({ data }) => setEqs((data as unknown as Eq[]) ?? []))
  useEffect(() => { cargar() }, [])

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const provs = useMemo(() => [...new Set(eqs.map((e) => e.proveedores.nombre))].sort(), [eqs])
  const lista = eqs.filter((e) => (!prov || e.proveedores.nombre === prov) && (!q || norm(`${e.descripcion_proveedor} ${e.codigo_proveedor ?? ''} ${porId.get(e.producto_id)?.nombre ?? ''}`).includes(norm(q))))

  async function guardar(e: Eq, cambios: Partial<Eq>) {
    const { error } = await supabase.from('equivalencias').update({ ...cambios, actualizado_en: new Date().toISOString() }).eq('id', e.id)
    if (error) alert(mensajeError(error)); else { setEditando(null); cargar() }
  }
  async function borrar(e: Eq) {
    if (!confirm(`¿Olvidar que "${e.descripcion_proveedor}" es ${porId.get(e.producto_id)?.nombre}?`)) return
    await supabase.from('equivalencias').delete().eq('id', e.id); setEditando(null); cargar()
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Equivalencias de proveedores</h1>
      <p className="text-sm text-stone-600">Cómo figura cada producto en las facturas de tus proveedores → tu nombre de todos los días. Se aprende sola cuando cargás una compra; acá podés corregirla.</p>
      <div className="flex gap-2">
        <select value={prov} onChange={(e) => setProv(e.target.value)} className="campo"><option value="">Todos los proveedores</option>{provs.map((p) => <option key={p}>{p}</option>)}</select>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className="campo" placeholder="Buscar…" />
      {!eqs.length && <div className="tarjeta p-6 text-center text-stone-500">Todavía no hay equivalencias. Se crean solas cuando cargás una compra desde la foto de la factura.</div>}
      <ul className="tarjeta divide-y divide-stone-100">
        {lista.map((e) => (
          <li key={e.id}>
            <button onClick={() => setEditando(e)} className="w-full text-left px-3 py-2.5">
              <div className="text-xs text-stone-500">{e.proveedores.nombre}{e.codigo_proveedor ? ` · cód. ${e.codigo_proveedor}` : ''}{Number(e.unidades_por_bulto) > 1 ? ` · bulto x${Number(e.unidades_por_bulto)}` : ''}</div>
              <div className="text-sm">{e.descripcion_proveedor}</div>
              <div className="font-semibold text-marca flex items-center gap-1"><Icono n="flecha" className="w-3.5 h-3.5" />{porId.get(e.producto_id)?.nombre ?? '…'}</div>
            </button>
          </li>
        ))}
      </ul>
      {editando && <Editar eq={editando} productos={productos} actual={porId.get(editando.producto_id)} onGuardar={(c) => guardar(editando, c)} onBorrar={() => borrar(editando)} onCerrar={() => setEditando(null)} />}
    </div>
  )
}

function Editar({ eq, productos, actual, onGuardar, onBorrar, onCerrar }: { eq: Eq; productos: Producto[]; actual?: Producto; onGuardar: (c: Partial<Eq>) => void; onBorrar: () => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const [prod, setProd] = useState<Producto | undefined>(actual)
  const [upb, setUpb] = useState(String(Number(eq.unidades_por_bulto)))
  const lista = useMemo(() => filtrar(productos, q, 20), [productos, q])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-fondo rounded-t-3xl max-h-[85vh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto space-y-2">
          <p className="text-sm text-stone-500">{eq.proveedores.nombre}{eq.codigo_proveedor ? ` · cód. ${eq.codigo_proveedor}` : ''}</p>
          <h3 className="font-bold">{eq.descripcion_proveedor}</h3>
          <div className="tarjeta p-3"><span className="etiqueta">Es mi producto</span><b>{prod?.nombre}</b></div>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="campo" placeholder="Cambiar por otro producto…" />
          {q && <ul className="tarjeta divide-y divide-stone-100">{lista.map((p) => <li key={p.id}><button onClick={() => { setProd(p); setQ('') }} className="w-full text-left px-3 py-2">{p.nombre}</button></li>)}</ul>}
          <div><label className="etiqueta">Unidades por bulto</label><input value={upb} onChange={(e) => setUpb(e.target.value)} className="campo num" inputMode="decimal" /></div>
          <button onClick={() => prod && onGuardar({ producto_id: prod.id, unidades_por_bulto: Number(upb.replace(',', '.')) || 1 })} className="btn-primario w-full">Guardar</button>
          <button onClick={onBorrar} className="w-full text-red-600 text-sm py-2">Olvidar esta equivalencia</button>
        </div>
      </div>
    </div>
  )
}
