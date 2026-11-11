import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
const Escaner = lazy(() => import('../components/Escaner'))
import Icono from '../components/Icono'
import { useCatalogo, useConfig } from '../lib/catalogo'
import { $, filtrar, n } from '../lib/formato'
import { cola, enviarVenta, uuid, type VentaPendiente } from '../lib/offline'
import { mensajeError, supabase, type Producto } from '../lib/supabase'

type Linea = { p: Producto; cantidad: number; precio: number }
const K_CARRITO = 'br-carrito'

export default function Vender() {
  const { esDueno } = useAuth()
  const { productos, setProductos, recargar } = useCatalogo()
  const { config } = useConfig()
  const [q, setQ] = useState('')
  const [carrito, setCarrito] = useState<Linea[]>(() => {
    try { return JSON.parse(localStorage.getItem(K_CARRITO) ?? '[]') } catch { return [] }
  })
  const [metodo, setMetodo] = useState('')
  const [cliente, setCliente] = useState('')
  const [notas, setNotas] = useState('')
  const [escaneando, setEscaneando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null)
  const [verCarrito, setVerCarrito] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [codigoSinAsignar, setCodigoSinAsignar] = useState<string | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem(K_CARRITO, JSON.stringify(carrito)) }, [carrito])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t) }, [aviso])

  const resultados = useMemo(() => filtrar(productos, q, 40), [productos, q])
  const total = carrito.reduce((s, l) => s + l.cantidad * l.precio, 0)
  const unidades = carrito.reduce((s, l) => s + l.cantidad, 0)

  const agregar = useCallback((p: Producto, cant = 1) => {
    setCarrito((c) => {
      const i = c.findIndex((l) => l.p.id === p.id)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + cant } : l))
      return [...c, { p, cantidad: cant, precio: p.precio }]
    })
    navigator.vibrate?.(20)
  }, [])

  const alEscanear = useCallback((codigo: string) => {
    const p = productos.find((x) => x.codigo_barras === codigo || x.sku === codigo.toUpperCase())
    if (p) {
      agregar(p)
      setAviso({ tipo: 'ok', texto: `+1 ${p.nombre}` })
    } else {
      setEscaneando(false)
      if (esDueno) setCodigoSinAsignar(codigo)
      else setAviso({ tipo: 'error', texto: `El código ${codigo} no está cargado. Buscalo por nombre.` })
    }
  }, [productos, agregar, esDueno])

  function cambiarCant(id: number, delta: number) {
    setCarrito((c) => c.flatMap((l) => (l.p.id !== id ? [l] : l.cantidad + delta <= 0 ? [] : [{ ...l, cantidad: Math.round((l.cantidad + delta) * 100) / 100 }])))
  }
  function fijarCant(id: number, v: string) {
    const x = Number(v.replace(',', '.'))
    setCarrito((c) => c.map((l) => (l.p.id === id ? { ...l, cantidad: isNaN(x) ? l.cantidad : x } : l)))
  }
  function fijarPrecio(id: number, v: string) {
    const x = Number(v.replace(/\./g, '').replace(',', '.'))
    setCarrito((c) => c.map((l) => (l.p.id === id ? { ...l, precio: isNaN(x) ? l.precio : x } : l)))
  }

  async function cobrar() {
    if (!carrito.length) return
    if (!metodo) { setAviso({ tipo: 'error', texto: 'Elegí el medio de pago' }); return }
    if (carrito.some((l) => !(l.cantidad > 0))) { setAviso({ tipo: 'error', texto: 'Hay una cantidad inválida' }); return }
    const venta: VentaPendiente = {
      client_uuid: uuid(),
      fecha: new Date().toISOString(),
      items: carrito.map((l) => ({
        producto_id: l.p.id, cantidad: l.cantidad, nombre: l.p.nombre, precio_lista: l.p.precio,
        ...(esDueno && l.precio !== l.p.precio ? { precio: l.precio } : {}),
      })),
      metodo_pago: metodo, cliente, notas,
    }
    setEnviando(true)
    try {
      const r = await enviarVenta(venta)
      setAviso({ tipo: 'ok', texto: `Venta registrada · ${$(Number(r.total))}` })
    } catch (e) {
      const msg = mensajeError(e)
      if (msg === 'Sin conexión a internet') {
        cola.agregar(venta)
        setAviso({ tipo: 'info', texto: 'Sin señal: la venta quedó guardada y se envía sola' })
      } else {
        setEnviando(false)
        setAviso({ tipo: 'error', texto: msg })
        return
      }
    }
    // descuenta stock en pantalla al instante
    setProductos((ps) => ps.map((p) => { const l = carrito.find((x) => x.p.id === p.id); return l ? { ...p, stock: p.stock - l.cantidad } : p }))
    setCarrito([]); setMetodo(''); setCliente(''); setNotas(''); setVerCarrito(false); setQ('')
    setEnviando(false)
    setTimeout(recargar, 1500)
  }

  return (
    <div>
      {/* Buscador */}
      <div className="sticky top-12 z-20 -mx-3 px-3 pt-1 pb-2 bg-fondo">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Icono n="buscar" className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input ref={buscador} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o código…" className="campo pl-10 pr-9" inputMode="search" />
            {q && <button onClick={() => { setQ(''); buscador.current?.focus() }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400"><Icono n="x" /></button>}
          </div>
          <button onClick={() => setEscaneando(true)} className="btn-primario px-3" aria-label="Escanear código"><Icono n="camara" className="w-6 h-6" /></button>
        </div>
      </div>

      {/* Resultados */}
      <ul className="tarjeta divide-y divide-stone-100 overflow-hidden">
        {resultados.map((p) => {
          const enCarrito = carrito.find((l) => l.p.id === p.id)?.cantidad
          return (
            <li key={p.id}>
              <button onClick={() => agregar(p)} className="w-full text-left px-3 py-2.5 flex items-center gap-3 active:bg-marca-claro/50">
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight truncate">{p.nombre}</div>
                  <div className="text-xs text-stone-500 mt-0.5 flex gap-2">
                    <span>{p.sku}</span>
                    <span className={p.stock <= 0 ? 'text-red-600 font-semibold' : p.stock <= p.stock_minimo ? 'text-amber-600 font-semibold' : ''}>Stock {n(p.stock)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold num">{p.precio > 0 ? $(p.precio) : <span className="text-red-600 text-sm">Sin precio</span>}</div>
                  {enCarrito ? <span className="chip bg-marca text-white mt-0.5">×{n(enCarrito)}</span> : null}
                </div>
              </button>
            </li>
          )
        })}
        {!resultados.length && <li className="p-6 text-center text-stone-500">{productos.length ? 'No encontré ese producto' : 'Cargando productos…'}</li>}
      </ul>

      {/* Barra del carrito */}
      {carrito.length > 0 && !verCarrito && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-3">
          <button onClick={() => setVerCarrito(true)} className="max-w-3xl mx-auto w-full btn-primario py-3.5 text-base shadow-lg justify-between">
            <span className="flex items-center gap-2"><Icono n="carrito" /> {n(unidades)} {unidades === 1 ? 'producto' : 'productos'}</span>
            <span className="num text-lg">{$(total)} <Icono n="flecha" className="w-4 h-4 inline" /></span>
          </button>
        </div>
      )}

      {/* Carrito / cobro */}
      {verCarrito && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setVerCarrito(false)}>
          <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto bg-fondo rounded-t-3xl pb-[env(safe-area-inset-bottom)]">
            <div className="max-w-3xl mx-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold">Venta</h2>
                <button onClick={() => setVerCarrito(false)} className="p-2 rounded-full bg-white border border-stone-200"><Icono n="x" /></button>
              </div>

              <ul className="tarjeta divide-y divide-stone-100">
                {carrito.map((l) => (
                  <li key={l.p.id} className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 font-medium leading-tight">{l.p.nombre}</div>
                      <button onClick={() => setCarrito((c) => c.filter((x) => x.p.id !== l.p.id))} className="text-stone-400 p-1" aria-label="Quitar"><Icono n="basura" className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => cambiarCant(l.p.id, -1)} className="w-9 h-9 rounded-lg bg-stone-100 grid place-items-center"><Icono n="menos" /></button>
                      <input value={l.cantidad} onChange={(e) => fijarCant(l.p.id, e.target.value)} inputMode="decimal" className="w-14 text-center campo py-1.5 num" />
                      <button onClick={() => cambiarCant(l.p.id, 1)} className="w-9 h-9 rounded-lg bg-stone-100 grid place-items-center"><Icono n="sumar" /></button>
                      <span className="text-stone-400 text-sm">×</span>
                      {esDueno ? (
                        <input defaultValue={l.precio} onBlur={(e) => fijarPrecio(l.p.id, e.target.value)} inputMode="decimal" className={`w-24 campo py-1.5 num ${l.precio !== l.p.precio ? 'border-acento' : ''}`} />
                      ) : (
                        <span className="num text-sm text-stone-600">{$(l.precio)}</span>
                      )}
                      <span className="flex-1 text-right font-bold num">{$(l.cantidad * l.precio)}</span>
                    </div>
                    {l.p.stock - l.cantidad < 0 && <p className="text-xs text-amber-700 mt-1">Stock en sistema: {n(l.p.stock)} (queda negativo)</p>}
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <span className="etiqueta">Medio de pago</span>
                <div className="flex flex-wrap gap-2">
                  {config.metodos_pago.map((m) => (
                    <button key={m} onClick={() => setMetodo(m)} className={`px-3.5 py-2 rounded-xl border font-semibold text-sm ${metodo === m ? 'bg-marca text-white border-marca' : 'bg-white border-stone-300'}`}>{m}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="etiqueta">Cliente (opcional)</label>
                  <input value={cliente} onChange={(e) => setCliente(e.target.value)} className="campo" placeholder="Nombre" />
                </div>
                <div>
                  <label className="etiqueta">Nota (opcional)</label>
                  <input value={notas} onChange={(e) => setNotas(e.target.value)} className="campo" placeholder="Ej: debe $500" />
                </div>
              </div>

              <div className="flex items-center justify-between mt-5 mb-3">
                <span className="text-stone-500">Total</span>
                <span className="text-3xl font-extrabold num">{$(total)}</span>
              </div>
              <button onClick={cobrar} disabled={enviando} className="btn-primario w-full py-4 text-lg">
                <Icono n="check" /> {enviando ? 'Registrando…' : 'Confirmar venta'}
              </button>
              <button onClick={() => { if (confirm('¿Vaciar la venta?')) { setCarrito([]); setVerCarrito(false) } }} className="w-full mt-2 py-2 text-stone-500 text-sm">Vaciar</button>
            </div>
          </div>
        </div>
      )}

      {escaneando && <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/90" />}><Escaner onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} /></Suspense>}
      {codigoSinAsignar && (
        <AsignarCodigo codigo={codigoSinAsignar} productos={productos} onCerrar={() => setCodigoSinAsignar(null)}
          onAsignado={(p) => { setProductos((ps) => ps.map((x) => (x.id === p.id ? { ...x, codigo_barras: codigoSinAsignar } : x))); agregar({ ...p, codigo_barras: codigoSinAsignar }); setCodigoSinAsignar(null); setAviso({ tipo: 'ok', texto: `Código guardado en ${p.nombre}` }) }} />
      )}

      {aviso && (
        <div className={`fixed left-1/2 -translate-x-1/2 top-16 z-50 max-w-[90vw] px-4 py-2.5 rounded-xl shadow-lg font-medium text-white ${aviso.tipo === 'ok' ? 'bg-emerald-600' : aviso.tipo === 'error' ? 'bg-red-600' : 'bg-stone-800'}`}>
          {aviso.texto}
        </div>
      )}
    </div>
  )
}

/** El dueño escanea un código nuevo y elige a qué producto pertenece */
function AsignarCodigo({ codigo, productos, onCerrar, onAsignado }: { codigo: string; productos: Producto[]; onCerrar: () => void; onAsignado: (p: Producto) => void }) {
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const lista = useMemo(() => filtrar(productos.filter((p) => !p.codigo_barras), q, 30), [productos, q])
  async function asignar(p: Producto) {
    const { error } = await supabase.from('productos').update({ codigo_barras: codigo }).eq('id', p.id)
    if (error) setError(/duplicate|unique/i.test(error.message) ? 'Ese código ya está asignado a otro producto' : mensajeError(error))
    else onAsignado(p)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid items-end" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-fondo rounded-t-3xl max-h-[85vh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-lg font-bold">Código nuevo: <span className="num">{codigo}</span></h2>
          <p className="text-sm text-stone-600 mb-3">¿A qué producto corresponde? Queda guardado para la próxima.</p>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo mb-2" placeholder="Buscar producto…" />
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <ul className="tarjeta divide-y divide-stone-100">
            {lista.map((p) => (
              <li key={p.id}><button onClick={() => asignar(p)} className="w-full text-left px-3 py-2.5">{p.nombre} <span className="text-xs text-stone-500">{p.sku}</span></button></li>
            ))}
          </ul>
          <button onClick={onCerrar} className="btn-secundario w-full mt-3">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
