import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import Icono from '../components/Icono'

export default function Mas() {
  const { esDueno, perfil, salir } = useAuth()
  const items = [
    ...(esDueno ? [
      { to: '/resumen', n: 'grafico', t: 'Resumen del negocio', d: 'Ventas, ganancia, stock y más vendidos' },
      { to: '/comparador', n: 'balanza', t: 'Comparador de proveedores', d: 'Subí listas de precios y compará' },
    ] : []),
    { to: '/envios', n: 'envio', t: 'Envíos', d: 'Pedidos para entregar' },
    { to: '/ajustes', n: 'ajustes', t: esDueno ? 'Ajustes' : 'Mi PIN', d: esDueno ? 'Usuarios, márgenes, Google Sheets' : 'Cambiar mi PIN' },
  ]
  return (
    <div className="space-y-3">
      <ul className="tarjeta divide-y divide-stone-100">
        {items.map((i) => (
          <li key={i.to}><Link to={i.to} className="flex items-center gap-3 px-4 py-3.5">
            <span className="w-10 h-10 rounded-xl bg-marca-claro text-marca grid place-items-center"><Icono n={i.n} /></span>
            <span className="flex-1"><b>{i.t}</b><span className="block text-sm text-stone-500">{i.d}</span></span>
            <Icono n="flecha" className="w-4 h-4 text-stone-400" />
          </Link></li>
        ))}
      </ul>
      <button onClick={() => confirm('¿Cerrar sesión?') && salir()} className="btn-secundario w-full"><Icono n="salir" /> Salir ({perfil?.nombre})</button>
      <p className="text-center text-xs text-stone-400">Tip: en el celular, abrí el menú del navegador y elegí “Agregar a pantalla de inicio”.</p>
    </div>
  )
}
