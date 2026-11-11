import { useEffect, useState } from 'react'
import { mensajeError, pinAPassword, supabase } from '../lib/supabase'
import Icono from '../components/Icono'

type Usuario = { nombre: string; email: string }
const K_USUARIOS = 'br-usuarios-login'

export default function Login() {
  const [usuarios, setUsuarios] = useState<Usuario[]>(() => {
    try { return JSON.parse(localStorage.getItem(K_USUARIOS) ?? '[]') } catch { return [] }
  })
  const [elegido, setElegido] = useState<Usuario | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    supabase.rpc('usuarios_login').then(({ data, error }) => {
      if (error) { if (!usuarios.length) setError(mensajeError(error)); return }
      setUsuarios(data as Usuario[])
      localStorage.setItem(K_USUARIOS, JSON.stringify(data))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function entrar(p: string) {
    if (!elegido) return
    setEnviando(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: elegido.email, password: pinAPassword(p) })
    setEnviando(false)
    if (error) { setError(mensajeError(error)); setPin('') }
  }

  function tecla(k: string) {
    if (enviando) return
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    const nuevo = (pin + k).slice(0, 6)
    setPin(nuevo)
    if (nuevo.length === 4) entrar(nuevo)
  }

  return (
    <div className="min-h-full bg-marca text-white flex flex-col items-center px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-10">
      <div className="w-16 h-16 rounded-2xl bg-white/10 grid place-items-center mb-4">
        <svg viewBox="0 0 512 512" className="w-10 h-10"><circle cx="256" cy="256" r="150" fill="none" stroke="#f6f5f1" strokeWidth="44" /><circle cx="256" cy="256" r="52" fill="#fbbf24" /></svg>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Buen Rollo</h1>
      <p className="text-teal-100 mt-1 mb-8">{elegido ? `Hola ${elegido.nombre}, ingresá tu PIN` : '¿Quién sos?'}</p>

      {!elegido ? (
        <div className="w-full max-w-sm grid grid-cols-2 gap-3">
          {usuarios.map((u) => (
            <button key={u.email} onClick={() => { setElegido(u); setError('') }} className="rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 transition py-6 flex flex-col items-center gap-2">
              <span className="w-12 h-12 rounded-full bg-white text-marca grid place-items-center text-xl font-bold">{u.nombre[0]}</span>
              <span className="font-semibold">{u.nombre}</span>
            </button>
          ))}
          {!usuarios.length && !error && <p className="col-span-2 text-center text-teal-100">Cargando usuarios…</p>}
        </div>
      ) : (
        <div className="w-full max-w-xs">
          <div className="flex justify-center gap-4 mb-6">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`w-4 h-4 rounded-full border-2 border-white ${i < pin.length ? 'bg-white' : ''}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
              k ? (
                <button key={i} onClick={() => tecla(k)} className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-2xl font-semibold">
                  {k}
                </button>
              ) : <span key={i} />,
            )}
          </div>
          <button onClick={() => { setElegido(null); setPin(''); setError('') }} className="mt-6 w-full text-teal-100 underline underline-offset-4">
            Cambiar de usuario
          </button>
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-center gap-2 bg-red-500/90 rounded-xl px-4 py-2">
          <Icono n="alerta" /> {error}
        </div>
      )}
      {enviando && <p className="mt-4 text-teal-100">Entrando…</p>}
    </div>
  )
}
