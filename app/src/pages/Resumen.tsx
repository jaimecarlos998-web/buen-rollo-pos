import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { $, n } from '../lib/formato'
import { mensajeError, supabase } from '../lib/supabase'

type R = {
  productos: number; a_reponer: number; valor_stock_costo: number; valor_stock_venta: number
  ventas_hoy: number; pedidos_hoy: number; ventas_mes: number; ganancia_mes: number; compras_mes: number; envios_pendientes: number
  por_metodo: Record<string, number>; por_vendedor: Record<string, number>
  ultimos_30_dias: { dia: string; total: number }[]; top_productos: { nombre: string; unidades: number; total: number }[]
}

function Kpi({ t, v, sub }: { t: string; v: string; sub?: string }) {
  return <div className="tarjeta p-3"><div className="etiqueta">{t}</div><div className="text-xl font-extrabold num">{v}</div>{sub && <div className="text-xs text-stone-500">{sub}</div>}</div>
}

function Barras({ datos }: { datos: [string, number][] }) {
  const max = Math.max(...datos.map((d) => d[1]), 1)
  return (
    <div className="space-y-1.5">
      {datos.map(([k, v]) => (
        <div key={k} className="text-sm">
          <div className="flex justify-between"><span>{k}</span><b className="num">{$(v)}</b></div>
          <div className="h-2 rounded-full bg-stone-100"><div className="h-2 rounded-full bg-marca" style={{ width: `${(v / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

export default function Resumen() {
  const [r, setR] = useState<R | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { supabase.rpc('resumen').then(({ data, error }) => (error ? setError(mensajeError(error)) : setR(data as R))) }, [])
  if (error) return <p className="text-red-600">{error}</p>
  if (!r) return <p className="text-stone-500">Cargando…</p>

  const dias = r.ultimos_30_dias
  const maxDia = Math.max(...dias.map((d) => Number(d.total)), 1)
  const margen = r.ventas_mes ? (r.ganancia_mes / r.ventas_mes) * 100 : 0

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Resumen del negocio</h1>
      <div className="grid grid-cols-2 gap-2">
        <Kpi t="Ventas de hoy" v={$(r.ventas_hoy)} sub={`${r.pedidos_hoy} ventas`} />
        <Kpi t="Ventas del mes" v={$(r.ventas_mes)} />
        <Kpi t="Ganancia del mes" v={$(r.ganancia_mes)} sub={`${n(margen)}% de lo vendido`} />
        <Kpi t="Compras del mes" v={$(r.compras_mes)} />
        <Kpi t="Stock a costo" v={$(r.valor_stock_costo)} sub={`a venta ${$(r.valor_stock_venta)}`} />
        <Link to="/stock" className="tarjeta p-3 block"><div className="etiqueta">A reponer</div><div className="text-xl font-extrabold text-amber-600">{r.a_reponer}</div><div className="text-xs text-stone-500">de {r.productos} productos →</div></Link>
      </div>

      <div className="tarjeta p-3">
        <div className="etiqueta mb-2">Ventas por día (últimos 30 días)</div>
        <div className="flex items-end gap-[3px] h-32">
          {dias.map((d) => (
            <div key={d.dia} className="flex-1 bg-marca/80 rounded-t hover:bg-marca" style={{ height: `${(Number(d.total) / maxDia) * 100}%`, minHeight: 2 }} title={`${d.dia}: ${$(Number(d.total))}`} />
          ))}
        </div>
        {dias.length > 0 && <div className="flex justify-between text-[10px] text-stone-400 mt-1"><span>{dias[0].dia.slice(5)}</span><span>{dias[dias.length - 1].dia.slice(5)}</span></div>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="tarjeta p-3"><div className="etiqueta mb-2">Medios de pago (mes)</div><Barras datos={Object.entries(r.por_metodo).sort((a, b) => b[1] - a[1])} /></div>
        <div className="tarjeta p-3"><div className="etiqueta mb-2">Por vendedor/a (mes)</div><Barras datos={Object.entries(r.por_vendedor).sort((a, b) => b[1] - a[1])} /></div>
      </div>

      <div className="tarjeta p-3">
        <div className="etiqueta mb-2">Más vendidos (30 días)</div>
        <ol className="text-sm space-y-1">
          {r.top_productos.map((p, i) => <li key={p.nombre} className="flex justify-between gap-2"><span>{i + 1}. {p.nombre}</span><span className="num text-stone-600">{n(p.unidades)} u · <b>{$(p.total)}</b></span></li>)}
        </ol>
      </div>
    </div>
  )
}
