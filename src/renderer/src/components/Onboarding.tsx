import { useEffect, useRef } from 'react'
import { isAndroid } from '../lib/platform'
import { ClipboardIcon, DownloadIcon, FilmIcon, GripIcon, Logo, ShieldIcon } from './Icons'

// En Android no hay arrastre: el archivo queda en la galería y se abre desde ahí (o desde la Biblioteca).
export const STEPS = [
  isAndroid
    ? { icon: ClipboardIcon, title: 'Comparte o pega el link', text: 'Desde YouTube, TikTok, Instagram y más de 1,700 sitios.' }
    : { icon: ClipboardIcon, title: 'Copia y pega el link', text: 'De YouTube, TikTok, Instagram y más de 1,700 sitios.' },
  { icon: DownloadIcon, title: 'Elige video o audio', text: 'Calidad hasta 4K, o solo el audio en MP3, M4A o WAV.' },
  isAndroid
    ? { icon: FilmIcon, title: 'Ábrelo en tu editor', text: 'Queda en tu galería, en Películas o Música → Kapta Descargador.' }
    : { icon: GripIcon, title: 'Arrastra a CapCut', text: 'Suelta el archivo en tu línea de tiempo como toma de apoyo.' }
]

export function Onboarding({ onDone }: { onDone(): void }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => btnRef.current?.focus(), [])

  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-bg/95 p-6">
      {/* m-auto centra sin recortar el contenido cuando no cabe (teléfonos). */}
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="m-auto w-full max-w-[640px] text-center">
        <div className="flex justify-center">
          <Logo size={56} />
        </div>
        <h1 id="welcome-title" className="mt-5 font-display text-[28px] font-bold tracking-tight">
          Descarga video y audio para tus ediciones
        </h1>
        <p className="mt-2 text-muted">
          Sin páginas llenas de anuncios, botones falsos ni malware. Todo pasa en tu {isAndroid ? 'teléfono' : 'computadora'}.
        </p>

        <ol className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-[13px] font-bold text-accent">
                  {i + 1}
                </span>
                <Icon size={18} className="text-muted" />
              </div>
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-1 text-[13px] text-muted">{text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left text-[13px] text-muted">
          <ShieldIcon size={20} className="mt-0.5 shrink-0 text-ok" />
          <p>
            <span className="font-semibold text-ink">Uso responsable:</span> descarga solo contenido propio o que tengas permiso
            de usar, y respeta los derechos de autor y los términos de cada plataforma.
          </p>
        </div>

        <button
          ref={btnRef}
          onClick={onDone}
          className="mt-8 h-12 rounded-xl bg-accent px-10 text-[15px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Empezar
        </button>
      </div>
    </div>
  )
}
