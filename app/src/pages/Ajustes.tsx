import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { useConfig } from '../lib/catalogo'
import { mensajeError, supabase, type Perfil } from '../lib/supabase'

const HOJA_URL = 'https://docs.google.com/spreadsheets/d/10p6aU6lNbQTpoOkQlP3Q8TKJYTnD0DWFBZ5avsHiggo/edit'

function CambiarPin({ usuario, onListo }: { usuario: Perfil; onListo?: () => void }) {
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  async function guardar() {
    const { error } = await supabase.rpc('cambiar_pin', { p_usuario: usuario.id, p_pin: pin })
    setMsg(error ? mensajeError(error) : `PIN de ${usuario.nombre} actualizado`)
    if (!error) { setPin(''); onListo?.() }
  }
  return (
    <div className="flex gap-2 items-center">
      <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="PIN nuevo (4 a 6 números)" className="campo" type="password" />
      <button onClick={guardar} disabled={pin.length < 4} className="btn-primario shrink-0">Guardar</button>
      {msg && <span className="text-sm text-stone-600">{msg}</span>}
    </div>
  )
}

export default function Ajustes() {
  const { perfil, esDueno } = useAuth()
  if (!perfil) return null
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{esDueno ? 'Ajustes' : 'Mi PIN'}</h1>
      <section className="tarjeta p-3"><div className="etiqueta mb-2">Cambiar mi PIN</div><CambiarPin usuario={perfil} /></section>
      {esDueno && <><Usuarios /><Precios /><Sheets /></>}
    </div>
  )
}

function Usuarios() {
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState<Perfil[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState({ nombre: '', pin: '', rol: 'empleado' })
  const [msg, setMsg] = useState('')
  const cargar = () => supabase.from('perfiles').select('id,nombre,rol,activo').order('nombre').then(({ data }) => setUsuarios((data as Perfil[]) ?? []))
  useEffect(() => { cargar() }, [])

  async function actualizar(u: Perfil, cambios: Partial<Perfil>) {
    const { error } = await supabase.from('perfiles').update(cambios).eq('id', u.id)
    if (error) alert(mensajeError(error)); cargar()
  }
  async function crear() {
    const { error } = await supabase.rpc('crear_usuario', { p_nombre: nuevo.nombre, p_pin: nuevo.pin, p_rol: nuevo.rol })
    if (error) setMsg(mensajeError(error)); else { setMsg(`${nuevo.nombre} ya puede entrar con su PIN`); setNuevo({ nombre: '', pin: '', rol: 'empleado' }); cargar() }
  }

  return (
    <section className="tarjeta p-3 space-y-2">
      <div className="etiqueta">Usuarios</div>
      <ul className="divide-y divide-stone-100">
        {usuarios.map((u) => (
          <li key={u.id} className="py-2">
            <div className="flex items-center gap-2">
              <b className={`flex-1 ${u.activo ? '' : 'line-through text-stone-400'}`}>{u.nombre}</b>
              <span className={`chip ${u.rol === 'dueno' ? 'bg-marca text-white' : 'bg-stone-100'}`}>{u.rol === 'dueno' ? 'Dueño' : 'Empleado/a'}</span>
              <button onClick={() => setAbierto(abierto === u.id ? null : u.id)} className="text-marca text-sm font-semibold">Editar</button>
            </div>
            {abierto === u.id && (
              <div className="mt-2 space-y-2">
                <CambiarPin usuario={u} />
                {u.id !== perfil?.id && (
                  <div className="flex gap-2">
                    <button onClick={() => actualizar(u, { rol: u.rol === 'dueno' ? 'empleado' : 'dueno' })} className="btn-secundario text-sm py-1.5">{u.rol === 'dueno' ? 'Pasar a empleado/a' : 'Hacer dueño'}</button>
                    <button onClick={() => actualizar(u, { activo: !u.activo })} className="btn-secundario text-sm py-1.5">{u.activo ? 'Desactivar' : 'Reactivar'}</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="pt-2 border-t border-stone-100">
        <div className="text-sm font-semibold mb-1">Agregar usuario</div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="campo" placeholder="Nombre" />
          <input value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} className="campo" placeholder="PIN" inputMode="numeric" />
        </div>
        <div className="flex gap-2 mt-2">
          <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })} className="campo"><option value="empleado">Empleado/a</option><option value="dueno">Dueño</option></select>
          <button onClick={crear} disabled={!nuevo.nombre || nuevo.pin.length < 4} className="btn-primario shrink-0">Crear</button>
        </div>
        {msg && <p className="text-sm mt-1">{msg}</p>}
      </div>
    </section>
  )
}

function Precios() {
  const { config, recargar } = useConfig()
  const [margen, setMargen] = useState(String(config.margen_objetivo))
  const [redondeo, setRedondeo] = useState(String(config.redondeo))
  const [metodos, setMetodos] = useState(config.metodos_pago.join(', '))
  const [msg, setMsg] = useState('')
  useEffect(() => { setMargen(String(config.margen_objetivo)); setRedondeo(String(config.redondeo)); setMetodos(config.metodos_pago.join(', ')) }, [config])
  async function guardar() {
    const filas = [
      { clave: 'margen_objetivo', valor: Number(margen) || 0 },
      { clave: 'redondeo', valor: Number(redondeo) || 1 },
      { clave: 'metodos_pago', valor: metodos.split(',').map((s) => s.trim()).filter(Boolean) },
    ]
    const { error } = await supabase.from('config').upsert(filas)
    setMsg(error ? mensajeError(error) : 'Guardado'); recargar()
  }
  return (
    <section className="tarjeta p-3 space-y-2">
      <div className="etiqueta">Precios y cobro</div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-sm">Margen objetivo (%)</label><input value={margen} onChange={(e) => setMargen(e.target.value)} className="campo num" inputMode="decimal" /></div>
        <div><label className="text-sm">Redondear precios a $</label><input value={redondeo} onChange={(e) => setRedondeo(e.target.value)} className="campo num" inputMode="numeric" /></div>
      </div>
      <p className="text-xs text-stone-500">Se usa para sugerir el precio de venta cuando cargás una compra: costo × (1 + margen), redondeado hacia arriba.</p>
      <div><label className="text-sm">Medios de pago (separados por coma)</label><input value={metodos} onChange={(e) => setMetodos(e.target.value)} className="campo" /></div>
      <button onClick={guardar} className="btn-primario">Guardar</button> {msg && <span className="text-sm">{msg}</span>}
    </section>
  )
}

function Sheets() {
  const [token, setToken] = useState('')
  async function nuevoToken() {
    if (!confirm('Se genera una clave nueva y la anterior deja de funcionar. Vas a tener que pegarla en el script de la planilla. ¿Seguir?')) return
    const { data, error } = await supabase.rpc('sync_nuevo_token')
    if (error) alert(mensajeError(error)); else setToken(data as string)
  }
  return (
    <section className="tarjeta p-3 space-y-2">
      <div className="etiqueta">Google Sheets</div>
      <p className="text-sm">La planilla se sincroniza sola cada 5 minutos. También podés usar el menú <b>Buen Rollo → Sincronizar ahora</b> dentro de la planilla.</p>
      <a href={HOJA_URL} target="_blank" rel="noreferrer" className="btn-secundario w-full">Abrir planilla</a>
      <button onClick={nuevoToken} className="text-sm text-stone-500 underline">Generar clave de sincronización nueva</button>
      {token && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-sm">
          Copiá esta clave y pegala en la planilla (Extensiones → Apps Script → Configuración del proyecto → Propiedades del script → <code>SYNC_TOKEN</code>). Se muestra una sola vez:
          <div className="font-mono break-all bg-white rounded-lg p-2 mt-1 select-all">{token}</div>
        </div>
      )}
    </section>
  )
}
