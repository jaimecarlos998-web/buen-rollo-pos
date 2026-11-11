import { createClient } from '@supabase/supabase-js'

// Datos públicos del proyecto (la clave "publishable" está pensada para ir en la app).
export const SUPABASE_URL = 'https://nscbmuulxzrwqbsvmudm.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_cO_R_m86IAGkoRVAw9jobQ_2yzGCTC0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'br-pos-auth' },
})

export const pinAPassword = (pin: string) => `BR-pin-${pin}`

export type Producto = {
  id: number
  sku: string
  nombre: string
  codigo_barras: string | null
  costo?: number | null
  precio: number
  stock: number
  stock_minimo: number
  activo?: boolean
}

export type Perfil = { id: string; nombre: string; rol: 'dueno' | 'empleado'; activo: boolean }

export function mensajeError(e: unknown): string {
  if (!e) return 'Error desconocido'
  if (typeof e === 'string') return e
  const m = (e as { message?: string }).message ?? String(e)
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión a internet'
  if (/Invalid login credentials/i.test(m)) return 'PIN incorrecto'
  return m
}
