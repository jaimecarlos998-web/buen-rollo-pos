import { useEffect, useState } from 'react'
import Icono from '../components/Icono'
import { $, fecha, hoyISO } from '../lib/formato'
import { mensajeError, supabase } from '../lib/supabase'

type Envio = { id: number; fecha: string; cliente: string; telefono: string | null; direccion: string | null; detalle: string | null; estado: string; costo: number | null; notas: string | null }
const ESTADOS = ['Pendiente', 'Preparando', 'En camino', 'Entregado', 'Cancelado']
const color: Record<string, string> = { Pendiente: 'bg-amber-100 text-amber-800', Preparando: 'bg-sky-100 text-sky-800', 'En camino': 'bg-violet-100 text-violet-800', Entregado: 'bg-emerald-100 text-emerald-800', Cancelado: 'bg-stone-200 text-stone-600' }

export default function Envios() {
  const [envios, setEnvios] = useState<Envio[]>([])
  const [todos, setTodos] = useState(false)
  const [nuevo, setNuevo] = useState<Partial<Envio> | null>(null)
  const [error, setError] = useState('')

  async function cargar() {
    let qy = supabase.from('envios').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(100)
    if (!todos) qy = qy.in('estado', ['Pendiente', 'Preparando', 'En camino'])
    const { data, error } = await qy
    if (error) setError(mensajeError(error)); else setEnvios(data as Envio[])
  }
  useEffect(() => { cargar() }, [todos]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiarEstado(e: Envio, estado: string) {
    await supabase.from('envios').update({ estado }).eq('id', e.id); cargar()
  }
  async function guardar() {
    if (!nuevo?.cliente?.trim()) { setError('Falta el cliente'); return }
    const { error } = await supabase.from('envios').insert({ ...nuevo, fecha: nuevo.fecha || hoyISO() })
    if (error) setError(mensajeError(error)); else { setNuevo(null); setError(''); cargar() }
  }
  const set = (k: keyof Envio) => (e: React.ChangeEvent<HTMLInputElement>) => setNuevo({ ...nuevo, [k]: k === 'costo' ? Number(e.target.value) || null : e.target.value })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Envíos</h1>
        <button onClick={() => setNuevo({})} className="btn-primario py-2"><Icono n="sumar" /> Nuevo</button>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="w-5 h-5 accent-marca" /> Mostrar también entregados y cancelados</label>
      {nuevo && (
        <div className="tarjeta p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="etiqueta">Cliente</label><input onChange={set('cliente')} className="campo" /></div>
            <div><label className="etiqueta">Teléfono</label><input onChange={set('telefono')} className="campo" inputMode="tel" /></div>
          </div>
          <div><label className="etiqueta">Dirección</label><input onChange={set('direccion')} className="campo" /></div>
          <div><label className="etiqueta">Qué se envía</label><input onChange={set('detalle')} className="campo" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="etiqueta">Fecha</label><input type="date" defaultValue={hoyISO()} onChange={set('fecha')} className="campo" /></div>
            <div><label className="etiqueta">Costo envío</label><input onChange={set('costo')} className="campo num" inputMode="decimal" /></div>
          </div>
          <div className="flex gap-2"><button onClick={guardar} className="btn-primario flex-1">Guardar</button><button onClick={() => setNuevo(null)} className="btn-secundario">Cancelar</button></div>
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
      <ul className="space-y-2">
        {envios.map((e) => (
          <li key={e.id} className="tarjeta p-3">
            <div className="flex justify-between gap-2">
              <div><b>{e.cliente}</b> <span className="text-xs text-stone-500">{fecha(e.fecha)}</span>
                {e.direccion && <div className="text-sm">{e.direccion}</div>}
                {e.detalle && <div className="text-sm text-stone-600">{e.detalle}</div>}
                {e.telefono && <a href={`https://wa.me/${e.telefono.replace(/\D/g, '')}`} className="text-sm text-marca underline">{e.telefono}</a>}
              </div>
              <div className="text-right">{e.costo ? <div className="num text-sm">{$(e.costo)}</div> : null}</div>
            </div>
            <div className="flex gap-1.5 flex-wrap mt-2">
              {ESTADOS.map((s) => <button key={s} onClick={() => cambiarEstado(e, s)} className={`chip py-1 px-2.5 ${e.estado === s ? color[s] + ' ring-2 ring-current/30' : 'bg-stone-100 text-stone-500'}`}>{s}</button>)}
            </div>
          </li>
        ))}
        {!envios.length && <li className="tarjeta p-6 text-center text-stone-500">No hay envíos pendientes</li>}
      </ul>
    </div>
  )
}
