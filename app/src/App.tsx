import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import Icono from './components/Icono'
import { alCambiarCola, cola, vaciarCola } from './lib/offline'
import Login from './pages/Login'
import Vender from './pages/Vender'
import Stock from './pages/Stock'
import Ventas from './pages/Ventas'
import Compras from './pages/Compras'
const Comparador = lazy(() => import('./pages/Comparador'))
const Resumen = lazy(() => import('./pages/Resumen'))
const Equivalencias = lazy(() => import('./pages/Equivalencias'))
import Envios from './pages/Envios'
import Ajustes from './pages/Ajustes'
import Mas from './pages/Mas'

function useConexion() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pendientes, setPendientes] = useState(cola.todas().length)
  useEffect(() => {
    const on = () => { setOnline(true); vaciarCola() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const quitar = alCambiarCola(() => setPendientes(cola.todas().length))
    const t = setInterval(() => vaciarCola(), 30_000)
    vaciarCola()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); quitar(); clearInterval(t) }
  }, [])
  return { online, pendientes }
}

export default function App() {
  const { sesion, perfil, cargando, esDueno } = useAuth()
  const { online, pendientes } = useConexion()
  const loc = useLocation()

  if (cargando) return <div className="h-full grid place-items-center text-stone-400">Cargando…</div>
  if (!sesion) return <Login />

  const tabs = [
    { to: '/vender', n: 'carrito', t: 'Vender' },
    { to: '/stock', n: 'caja', t: 'Stock' },
    { to: '/ventas', n: 'lista', t: esDueno ? 'Ventas' : 'Mis ventas' },
    ...(esDueno
      ? [{ to: '/compras', n: 'camion', t: 'Compras' }, { to: '/mas', n: 'menu', t: 'Más' }]
      : [{ to: '/envios', n: 'envio', t: 'Envíos' }, { to: '/mas', n: 'menu', t: 'Más' }]),
  ]

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-marca text-white pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center gap-3">
          <div className="font-extrabold tracking-tight text-lg">Buen Rollo</div>
          <div className="flex-1" />
          {pendientes > 0 && (
            <button onClick={() => vaciarCola()} className="chip bg-acento text-stone-900" title="Ventas guardadas en el celular, se envían solas">
              {pendientes} sin enviar
            </button>
          )}
          <span title={online ? 'Conectado' : 'Sin conexión'} className={online ? 'text-teal-100' : 'text-amber-300'}>
            <Icono n={online ? 'nube' : 'nubeOff'} />
          </span>
          <span className="text-sm text-teal-50/90">{perfil?.nombre ?? ''}</span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-3 pt-3 pb-28">
        <Suspense fallback={<p className="text-stone-500">Cargando…</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/vender" replace />} />
          <Route path="/vender" element={<Vender />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/ventas" element={<Ventas />} />
          <Route path="/envios" element={<Envios />} />
          <Route path="/mas" element={<Mas />} />
          {esDueno && <Route path="/compras" element={<Compras />} />}
          {esDueno && <Route path="/comparador" element={<Comparador />} />}
          {esDueno && <Route path="/resumen" element={<Resumen />} />}
          {esDueno && <Route path="/equivalencias" element={<Equivalencias />} />}
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/vender" replace />} />
        </Routes>
        </Suspense>
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-stone-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => {
            const activo = loc.pathname.startsWith(t.to) || (t.to === '/mas' && ['/comparador', '/resumen', '/ajustes', '/envios', '/equivalencias'].some((p) => loc.pathname.startsWith(p)) && !tabs.some((x) => x.to !== '/mas' && loc.pathname.startsWith(x.to)))
            return (
              <NavLink key={t.to} to={t.to} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${activo ? 'text-marca' : 'text-stone-500'}`}>
                <Icono n={t.n} className="w-6 h-6" />
                {t.t}
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
