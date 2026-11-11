// Íconos de trazo simples (estilo lucide), sin dependencias.
const rutas: Record<string, string> = {
  carrito: 'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  caja: 'M21 8 12 3 3 8v8l9 5 9-5V8z M3 8l9 5 9-5 M12 13v8',
  camion: 'M3 6h11v10H3z M14 10h4l3 3v3h-7z M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  balanza: 'M12 3v18 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z M8 21h8',
  grafico: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  mas: 'M4 4h16v16H4z M12 8v8 M8 12h8',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.3-4.3',
  camara: 'M4 7h3l2-3h6l2 3h3v13H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  x: 'M6 6l12 12 M18 6 6 18',
  menos: 'M5 12h14',
  sumar: 'M12 5v14 M5 12h14',
  basura: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  check: 'M5 12l5 5L20 7',
  nube: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z',
  nubeOff: 'M3 3l18 18 M7 18a5 5 0 0 1-1.5-9.8 M10 6.3A6 6 0 0 1 19 10a4 4 0 0 1 1.7 7.6',
  salir: 'M9 21H5V3h4 M16 17l5-5-5-5 M21 12H9',
  envio: 'M3 12l18-9-7 18-3-7z',
  ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  lista: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  subir: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  flecha: 'M9 6l6 6-6 6',
  alerta: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arriba: 'M12 19V5 M5 12l7-7 7 7',
  abajo: 'M12 5v14 M19 12l-7 7-7-7',
}

export default function Icono({ n, className = 'w-5 h-5' }: { n: keyof typeof rutas | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {(rutas[n] ?? '').split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  )
}
