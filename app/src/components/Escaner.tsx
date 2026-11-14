import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import Icono from './Icono'

type Camara = { id: string; nombre: string }
type Capacidades = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number }
  torch?: boolean
  focusMode?: string[]
  focusDistance?: { min: number; max: number; step: number }
}

const K_CAMARA = 'br-camara'
const FORMATOS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]

/** Nombre entendible de cada cámara del celular */
function nombreCamara(label: string, i: number) {
  const l = label.toLowerCase()
  if (/ultra|ultrawide|ultra wide|gran angular|0[.,]5/.test(l)) return 'Ultra gran angular (macro)'
  if (/tele/.test(l)) return 'Teleobjetivo'
  if (/front|frontal|user|delantera/.test(l)) return 'Frontal'
  if (/dual|triple/.test(l)) return 'Automática'
  if (/back|trasera|rear|environment/.test(l)) return i === 0 ? 'Principal' : `Trasera ${i + 1}`
  return label || `Cámara ${i + 1}`
}

/** Lector de códigos de barras con la cámara del celular: cambio de cámara (macro), zoom, enfoque y linterna. */
export default function Escaner({ onCodigo, onCerrar }: { onCodigo: (c: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [camaras, setCamaras] = useState<Camara[]>([])
  const [camaraId, setCamaraId] = useState<string | null>(() => localStorage.getItem(K_CAMARA))
  const [caps, setCaps] = useState<Capacidades | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [enfoque, setEnfoque] = useState<number | null>(null)
  const [linterna, setLinterna] = useState(false)
  const pista = useRef<MediaStreamTrack | null>(null)
  const ultimo = useRef({ c: '', t: 0 })
  const cb = useRef(onCodigo)
  cb.current = onCodigo

  useEffect(() => {
    let controles: IScannerControls | undefined
    let cancelado = false
    setError(''); setCaps(null); setLinterna(false)
    const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, FORMATOS], [DecodeHintType.TRY_HARDER, true]])
    const lector = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 })
    const video_: MediaTrackConstraints = {
      // alta resolución: los códigos chicos se leen mucho mejor
      width: { ideal: 1920 }, height: { ideal: 1080 },
      ...(camaraId ? { deviceId: { exact: camaraId } } : { facingMode: { ideal: 'environment' } }),
    }
    lector
      .decodeFromConstraints({ video: video_ }, video.current!, (res) => {
        if (!res) return
        const c = res.getText()
        const ahora = Date.now()
        if (c === ultimo.current.c && ahora - ultimo.current.t < 2500) return
        ultimo.current = { c, t: ahora }
        navigator.vibrate?.(60)
        cb.current(c)
      })
      .then(async (c) => {
        if (cancelado) { c.stop(); return }
        controles = c
        const stream = video.current?.srcObject as MediaStream | null
        const t = stream?.getVideoTracks()[0] ?? null
        pista.current = t
        if (!t) return
        const cp = (t.getCapabilities?.() ?? {}) as Capacidades
        setCaps(cp)
        const st = t.getSettings() as MediaTrackSettings & { zoom?: number; focusDistance?: number }
        setZoom(st.zoom ?? null)
        setEnfoque(st.focusDistance ?? null)
        if (cp.focusMode?.includes('continuous')) t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        // con el permiso ya dado, los nombres de las cámaras están disponibles
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        const traseras = devs.filter((d) => !/front|frontal|user|delantera|facetime/i.test(d.label))
        const lista = (traseras.length ? traseras : devs).map((d, i) => ({ id: d.deviceId, nombre: nombreCamara(d.label, i) }))
        setCamaras(lista)
        if (!camaraId) { const actual = st.deviceId; if (actual) setCamaraIdSilencioso(actual) }
      })
      .catch((e) => {
        if (camaraId) { localStorage.removeItem(K_CAMARA); setCamaraId(null); return } // la cámara guardada ya no existe
        setError(/Permission|NotAllowed/i.test(String(e)) ? 'Hay que permitir el uso de la cámara' : 'No se pudo abrir la cámara')
      })
    return () => { cancelado = true; controles?.stop() }
  }, [camaraId])

  // recuerda qué cámara se está usando sin reiniciarla
  const actualRef = useRef<string | null>(null)
  function setCamaraIdSilencioso(id: string) { actualRef.current = id }

  function cambiarCamara(id: string) {
    localStorage.setItem(K_CAMARA, id)
    actualRef.current = id
    setCamaraId(id)
  }

  function aplicar(c: MediaTrackConstraintSet) {
    pista.current?.applyConstraints({ advanced: [c] }).catch(() => {})
  }

  const actual = camaraId ?? actualRef.current
  const indice = camaras.findIndex((c) => c.id === actual)

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 text-white pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="font-semibold">Apuntá al código de barras</span>
        <button onClick={onCerrar} className="p-2 rounded-full bg-white/10" aria-label="Cerrar"><Icono n="x" /></button>
      </div>

      <div className="relative flex-1 grid place-items-center overflow-hidden">
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-36 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <div className="absolute inset-x-10 top-1/2 h-0.5 bg-red-500/80" />
        {error && <p className="absolute bottom-10 bg-red-600 text-white px-4 py-2 rounded-xl">{error}</p>}
      </div>

      <div className="bg-black/90 text-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
        {camaras.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {camaras.map((c, i) => (
              <button key={c.id} onClick={() => cambiarCamara(c.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold border ${i === indice ? 'bg-white text-black border-white' : 'border-white/40 text-white'}`}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {caps?.zoom && zoom != null && caps.zoom.max > caps.zoom.min && (
          <label className="flex items-center gap-3 text-sm">
            <span className="w-16">Zoom</span>
            <input type="range" min={caps.zoom.min} max={Math.min(caps.zoom.max, 10)} step={caps.zoom.step || 0.1} value={zoom}
              onChange={(e) => { const z = Number(e.target.value); setZoom(z); aplicar({ zoom: z } as MediaTrackConstraintSet) }} className="flex-1 accent-white" />
            <span className="w-10 text-right num">{zoom.toFixed(1)}×</span>
          </label>
        )}

        {caps?.focusDistance && caps.focusMode?.includes('manual') && (
          <label className="flex items-center gap-3 text-sm">
            <span className="w-16">Enfoque</span>
            <input type="range" min={caps.focusDistance.min} max={caps.focusDistance.max} step={caps.focusDistance.step || 0.01} value={enfoque ?? caps.focusDistance.min}
              onChange={(e) => { const d = Number(e.target.value); setEnfoque(d); aplicar({ focusMode: 'manual', focusDistance: d } as MediaTrackConstraintSet) }} className="flex-1 accent-white" />
            <button onClick={() => { setEnfoque(null); aplicar({ focusMode: 'continuous' } as MediaTrackConstraintSet) }} className="text-xs underline">Auto</button>
          </label>
        )}

        <div className="flex gap-2 justify-center">
          {caps?.torch && (
            <button onClick={() => { const v = !linterna; setLinterna(v); aplicar({ torch: v } as MediaTrackConstraintSet) }}
              className={`px-4 py-2 rounded-xl font-semibold text-sm ${linterna ? 'bg-amber-400 text-black' : 'bg-white/10'}`}>
              🔦 Linterna {linterna ? 'encendida' : ''}
            </button>
          )}
        </div>
        <p className="text-center text-xs text-white/60">
          Para códigos chicos: alejá un poco el celular y usá el zoom{camaras.length > 1 ? ', o probá otra cámara (la macro enfoca más de cerca)' : ''}.
        </p>
      </div>
    </div>
  )
}
