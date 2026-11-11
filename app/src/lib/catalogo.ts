import { useCallback, useEffect, useState } from 'react'
import { catalogoLocal } from './offline'
import { supabase, type Producto } from './supabase'

/** Catálogo para vender: se muestra al instante desde el celular y se actualiza del servidor. */
export function useCatalogo() {
  const [productos, setProductos] = useState<Producto[]>(() => catalogoLocal.leer())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const recargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('catalogo')
    setCargando(false)
    if (error) { setError(error.message); return }
    setError('')
    const lista = (data as Producto[]).map((p) => ({ ...p, precio: Number(p.precio), stock: Number(p.stock), stock_minimo: Number(p.stock_minimo) }))
    setProductos(lista)
    catalogoLocal.guardar(lista)
  }, [])

  useEffect(() => { recargar() }, [recargar])
  return { productos, setProductos, cargando, error, recargar }
}

/** Productos con costo (sólo dueño) */
export function useProductosDueno() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [cargando, setCargando] = useState(true)
  const recargar = useCallback(async () => {
    setCargando(true)
    const todos: Producto[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase.from('productos').select('*').order('nombre').range(desde, desde + 999)
      if (error || !data) break
      todos.push(...(data as Producto[]))
      if (data.length < 1000) break
    }
    setProductos(todos.map((p) => ({ ...p, precio: Number(p.precio), stock: Number(p.stock), stock_minimo: Number(p.stock_minimo), costo: p.costo == null ? null : Number(p.costo) })))
    setCargando(false)
  }, [])
  useEffect(() => { recargar() }, [recargar])
  return { productos, setProductos, cargando, recargar }
}

export type Config = { margen_objetivo: number; redondeo: number; metodos_pago: string[] }
const DEF: Config = { margen_objetivo: 40, redondeo: 100, metodos_pago: ['Efectivo', 'Transferencia', 'Mercado Pago', 'Débito', 'Crédito'] }

export function useConfig() {
  const [config, setConfig] = useState<Config>(() => {
    try { return { ...DEF, ...JSON.parse(localStorage.getItem('br-config') ?? '{}') } } catch { return DEF }
  })
  const recargar = useCallback(async () => {
    const { data } = await supabase.from('config').select('clave,valor')
    if (!data) return
    const c = { ...DEF } as Record<string, unknown>
    for (const r of data) c[r.clave] = r.valor
    setConfig(c as Config)
    localStorage.setItem('br-config', JSON.stringify(c))
  }, [])
  useEffect(() => { recargar() }, [recargar])
  return { config, recargar }
}
