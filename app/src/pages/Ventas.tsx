import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import Icono from '../components/Icono'
import { $, fechaHora, hoyISO, n } from '../lib/formato'
import { alCambiarCola, cola, vaciarCola, type VentaPendiente } from '../lib/offline'
import { mensajeError, supabase } from '../lib/supabase'

type Venta = {
  id: number; nro: string; fecha: string; vendedor_nombre: string | null; cliente: string | null
  metodo_pago: string | null; total: number; costo_total: number | null; notas: string | null; anulada: boolean
  venta_items: { nombre: string; cantidad: number; precio_unit: number; subtotal: number }[]
}

function rangoDia(d: string) {
  // día en hora argentina (UTC-3)
  const desde = new Date(`${d}T00:00:00-03:00`).toISOString()
  const hasta = new Date(new Date(`${d}T00:00:00-03:00`).getTime() + 86400000).toISOString()
  return { desde, hasta }
}

export default function Ventas() {
  const { esDueno } = useAuth()
  const [dia, setDia] = useState(hoyISO())
  const [ventas, setVentas] = useState<Venta[]>([])
  const [cargando, setCargando] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [pendientes, setPendientes] = useState<VentaPendiente[]>(cola.todas())
  const [error, setError] = useState('')

  useEffect(() => alCambiarCola(() => setPendientes(cola.todas())), [])

  const cargar = useCallback(async () => {
    setCargando(true)
    const { desde, hasta } = rangoDia(dia)
    const { data, error } = await supabase.from('ventas')
      .select('id,nro,fecha,vendedor_nombre,cliente,metodo_pago,total,costo_total,notas,anulada,venta_items(nombre,cantidad,precio_unit,subtotal)')
      .gte('fecha', desde).lt('fecha', hasta).order('fecha', { ascending: false })
    setCargando(false)
    if (error) setError(mensajeError(error)); else { setError(''); setVentas(data as Venta[]) }
  }, [dia])
  useEffect(() => { cargar() }, [cargar])

  const validas = ventas.filter((v) => !v.anulada)
  const total = validas.reduce((s, v) => s + Number(v.total), 0)
  const ganancia = validas.reduce((s, v) => s + Number(v.total) - Number(v.costo_total ?? 0), 0)
  const porMetodo = useMemo(() => {
    const m: Record<string, number> = {}
    for (const v of validas) m[v.metodo_pago ?? 'Sin dato'] = (m[v.metodo_pago ?? 'Sin dato'] ?? 0) + Number(v.total)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [validas])

  function moverDia(delta: number) {
    const d = new Date(`${dia}T12:00:00`); d.setDate(d.getDate() + delta)
    setDia(d.toISOString().slice(0, 10))
  }

  async function anular(v: Venta) {
    if (!confirm(`¿Anular la venta ${v.nro} por ${$(v.total)}? Se devuelve el stock.`)) return
    const { error } = await supabase.rpc('anular_venta', { p_venta_id: v.id })
    if (error) alert(mensajeError(error)); else cargar()
  }

  return (
    <div className="space-y-3">
      {pendientes.length > 0 && (
        <div className="tarjeta p-3 border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between">
            <b>{pendientes.length} venta(s) guardadas en este celular</b>
            <button onClick={() => vaciarCola().then(cargar)} className="btn-secundario py-1.5 text-sm">Enviar ahora</button>
          </div>
          {pendientes.map((p) => (
            <div key={p.client_uuid} className="text-sm mt-2 flex justify-between gap-2">
              <span>{fechaHora(p.fecha)} · {p.items.length} prod. · {p.metodo_pago}{p.error && <span className="text-red-600"> · {p.error}</span>}</span>
              {p.error && <button onClick={() => confirm('¿Descartar esta venta guardada?') && cola.quitar(p.client_uuid)} className="text-red-600">Descartar</button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={() => moverDia(-1)} className="btn-secundario px-3 rotate-180"><Icono n="flecha" /></button>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="campo text-center" />
        <button onClick={() => moverDia(1)} className="btn-secundario px-3" disabled={dia >= hoyISO()}><Icono n="flecha" /></button>
      </div>

      <div className="tarjeta p-4">
        <div className="flex justify-between items-end">
          <div><div className="etiqueta">{esDueno ? 'Vendido en el día' : 'Lo que vendiste'}</div><div className="text-3xl font-extrabold num">{$(total)}</div></div>
          <div className="text-right text-sm text-stone-500">{validas.length} ventas{esDueno && <><br />Ganancia <b className="text-emerald-700 num">{$(ganancia)}</b></>}</div>
        </div>
        {porMetodo.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm">
            {porMetodo.map(([m, t]) => <span key={m}><span className="text-stone-500">{m}</span> <b className="num">{$(t)}</b></span>)}
          </div>
        )}
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {cargando && <p className="text-stone-500 text-sm">Cargando…</p>}

      <ul className="tarjeta divide-y divide-stone-100">
        {ventas.map((v) => (
          <li key={v.id} className={v.anulada ? 'opacity-50' : ''}>
            <button onClick={() => setAbierta(abierta === v.id ? null : v.id)} className="w-full text-left px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{new Date(v.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })} · {v.cliente || 'Sin nombre'}</div>
                <div className="text-xs text-stone-500">{v.metodo_pago} {esDueno && v.vendedor_nombre ? `· ${v.vendedor_nombre}` : ''} · {v.venta_items.length} prod.{v.anulada && ' · ANULADA'}</div>
              </div>
              <div className="font-bold num">{$(v.total)}</div>
            </button>
            {abierta === v.id && (
              <div className="px-3 pb-3 text-sm">
                {v.venta_items.map((i, k) => (
                  <div key={k} className="flex justify-between gap-2 py-0.5"><span>{n(i.cantidad)} × {i.nombre}</span><span className="num">{$(i.subtotal)}</span></div>
                ))}
                {v.notas && <p className="mt-1 text-stone-600">📝 {v.notas}</p>}
                <div className="flex justify-between mt-2 text-xs text-stone-500"><span>{v.nro}</span>
                  {esDueno && !v.anulada && <button onClick={() => anular(v)} className="text-red-600 font-semibold">Anular venta</button>}
                </div>
              </div>
            )}
          </li>
        ))}
        {!ventas.length && !cargando && <li className="p-6 text-center text-stone-500">No hay ventas este día</li>}
      </ul>
    </div>
  )
}
