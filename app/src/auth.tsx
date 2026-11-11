import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Perfil } from './lib/supabase'

type Ctx = {
  sesion: Session | null
  perfil: Perfil | null
  cargando: boolean
  esDueno: boolean
  salir: () => Promise<void>
}
const AuthCtx = createContext<Ctx>({ sesion: null, perfil: null, cargando: true, esDueno: false, salir: async () => {} })

const K_PERFIL = 'br-perfil'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(() => {
    try { return JSON.parse(localStorage.getItem(K_PERFIL) ?? 'null') } catch { return null }
  })
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const uid = sesion?.user.id
    if (!uid) { setPerfil(null); localStorage.removeItem(K_PERFIL); return }
    supabase.from('perfiles').select('id,nombre,rol,activo').eq('id', uid).single().then(({ data }) => {
      if (data) { setPerfil(data as Perfil); localStorage.setItem(K_PERFIL, JSON.stringify(data)) }
    })
  }, [sesion?.user.id])

  const salir = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(K_PERFIL)
    setPerfil(null)
  }

  return (
    <AuthCtx.Provider value={{ sesion, perfil, cargando, esDueno: perfil?.rol === 'dueno', salir }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
