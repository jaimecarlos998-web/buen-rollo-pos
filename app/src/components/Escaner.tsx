import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import Icono from './Icono'

/** Lector de códigos de barras con la cámara trasera del celular. */
export default function Escaner({ onCodigo, onCerrar }: { onCodigo: (c: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const ultimo = useRef({ c: '', t: 0 })

  useEffect(() => {
    let controles: IScannerControls | undefined
    let cancelado = false
    const lector = new BrowserMultiFormatReader()
    lector
      .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current!, (res) => {
        if (!res) return
        const c = res.getText()
        const ahora = Date.now()
        if (c === ultimo.current.c && ahora - ultimo.current.t < 2500) return // evita lecturas repetidas
        ultimo.current = { c, t: ahora }
        navigator.vibrate?.(60)
        onCodigo(c)
      })
      .then((c) => { if (cancelado) c.stop(); else controles = c })
      .catch((e) => setError(/Permission|NotAllowed/i.test(String(e)) ? 'Hay que permitir el uso de la cámara' : 'No se pudo abrir la cámara'))
    return () => { cancelado = true; controles?.stop() }
  }, [onCodigo])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center justify-between p-4 text-white pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="font-semibold">Apuntá al código de barras</span>
        <button onClick={onCerrar} className="p-2 rounded-full bg-white/10" aria-label="Cerrar"><Icono n="x" /></button>
      </div>
      <div className="relative flex-1 grid place-items-center">
        <video ref={video} className="w-full max-h-full object-cover" muted playsInline />
        <div className="absolute inset-x-10 top-1/2 -translate-y-1/2 h-40 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <div className="absolute inset-x-12 top-1/2 h-0.5 bg-red-500/80" />
        {error && <p className="absolute bottom-10 bg-red-600 text-white px-4 py-2 rounded-xl">{error}</p>}
      </div>
    </div>
  )
}
