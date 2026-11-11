import { supabase, type Producto } from './supabase'

// Ventas que no se pudieron enviar (sin señal). Se reintentan solas.
export type VentaPendiente = {
  client_uuid: string
  fecha: string
  items: { producto_id: number; cantidad: number; precio?: number; nombre: string; precio_lista: number }[]
  metodo_pago: string
  cliente: string
  notas: string
  error?: string
}

const K_COLA = 'br-cola-ventas'
const K_CATALOGO = 'br-catalogo'

const leer = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d }
}
const guardar = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* almacenamiento lleno o bloqueado */ }
}

export const cola = {
  todas: () => leer<VentaPendiente[]>(K_COLA, []),
  agregar(v: VentaPendiente) { guardar(K_COLA, [...cola.todas(), v]); avisar() },
  quitar(uuid: string) { guardar(K_COLA, cola.todas().filter((v) => v.client_uuid !== uuid)); avisar() },
  marcarError(uuid: string, error: string) {
    guardar(K_COLA, cola.todas().map((v) => (v.client_uuid === uuid ? { ...v, error } : v))); avisar()
  },
}

export const catalogoLocal = {
  leer: () => leer<Producto[]>(K_CATALOGO, []),
  guardar: (p: Producto[]) => guardar(K_CATALOGO, p),
}

const oyentes = new Set<() => void>()
export function alCambiarCola(fn: () => void) { oyentes.add(fn); return () => { oyentes.delete(fn) } }
function avisar() { oyentes.forEach((f) => f()) }

export async function enviarVenta(v: VentaPendiente) {
  const { data, error } = await supabase.rpc('registrar_venta', {
    p_items: v.items.map(({ producto_id, cantidad, precio }) => (precio == null ? { producto_id, cantidad } : { producto_id, cantidad, precio })),
    p_metodo_pago: v.metodo_pago,
    p_cliente: v.cliente || null,
    p_notas: v.notas || null,
    p_client_uuid: v.client_uuid,
    p_fecha: v.fecha,
  })
  if (error) throw error
  return data as { id: number; nro: string; total: number }
}

let enviando = false
/** Reintenta las ventas pendientes. Devuelve cuántas se enviaron. */
export async function vaciarCola(): Promise<number> {
  if (enviando || !navigator.onLine) return 0
  enviando = true
  let ok = 0
  try {
    for (const v of cola.todas()) {
      try {
        await enviarVenta(v)
        cola.quitar(v.client_uuid)
        ok++
      } catch (e) {
        const msg = (e as Error).message ?? ''
        if (/fetch|network|load failed/i.test(msg)) break // sigue sin señal
        cola.marcarError(v.client_uuid, msg)
      }
    }
  } finally {
    enviando = false
  }
  return ok
}

export function uuid() {
  return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
