import type { AudioFormat, MediaInfo, Mode } from '@shared/types'
import { formatDuration, platformLabel, qualityHint, qualityLabel } from '../lib/format'
import { DownloadIcon, FilmIcon, FolderIcon, MusicIcon, WandIcon } from './Icons'

interface Props {
  media: MediaInfo
  mode: Mode
  quality: number
  audioFormat: AudioFormat
  editorCompatible: boolean
  onMode(mode: Mode): void
  onQuality(q: number): void
  onAudioFormat(f: AudioFormat): void
  onEditorCompatible(v: boolean): void
  onDownload(): void
  outputDir: string
  onChooseFolder(): void
}

const AUDIO_FORMATS: { id: AudioFormat; label: string; hint: string }[] = [
  { id: 'mp3', label: 'MP3', hint: 'Compatible' },
  { id: 'm4a', label: 'M4A', hint: 'Ligero' },
  { id: 'wav', label: 'WAV', hint: 'Sin pérdida' }
]

function Chip({ active, onClick, label, hint }: { active: boolean; onClick(): void; label: string; hint?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-[64px] flex-col items-center rounded-xl border px-3 py-1.5 transition-colors ${
        active ? 'border-accent bg-accent/12 text-ink' : 'border-line bg-bg text-muted hover:border-line-strong hover:text-ink'
      }`}
    >
      <span className="text-[14px] font-semibold leading-5">{label}</span>
      {hint && <span className={`text-[11px] leading-4 ${active ? 'text-accent' : 'text-faint'}`}>{hint}</span>}
    </button>
  )
}

/** "C:\Users\ana\Videos\Kapta Descargador" -> "…\Videos\Kapta Descargador"; en macOS y Linux, con "/". */
function shortPath(dir: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts.length > 3 ? `…${sep}${parts.slice(-2).join(sep)}` : dir
}

export function MediaCard(p: Props) {
  const { media } = p
  const hasVideo = media.qualities.length > 0
  const meta = [platformLabel(media.platform), media.uploader, formatDuration(media.duration)].filter(Boolean)

  return (
    <section className="flex gap-5 rounded-2xl border border-line bg-surface p-4">
      <div className="relative aspect-video w-[260px] shrink-0 overflow-hidden rounded-xl bg-raised">
        {media.thumbnail ? (
          <img src={media.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-faint">
            {hasVideo ? <FilmIcon size={32} /> : <MusicIcon size={32} />}
          </div>
        )}
        {media.duration !== undefined && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums">
            {formatDuration(media.duration)}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="line-clamp-2 font-display text-[17px] font-semibold leading-snug" title={media.title}>
          {media.title}
        </h2>
        <p className="mt-1 truncate text-[13px] text-muted">{meta.join(' · ')}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-line bg-bg p-1" role="radiogroup" aria-label="Tipo de descarga">
            {(['video', 'audio'] as Mode[]).map((m) => {
              const disabled = m === 'video' && !hasVideo
              const active = p.mode === m
              return (
                <button
                  key={m}
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => p.onMode(m)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-1.5 font-semibold transition-colors disabled:opacity-40 ${
                    active ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink'
                  }`}
                >
                  {m === 'video' ? <FilmIcon size={16} /> : <MusicIcon size={16} />}
                  {m === 'video' ? 'Video' : 'Solo audio'}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {p.mode === 'video'
            ? media.qualities.map((q) => (
                <Chip key={q} active={p.quality === q} onClick={() => p.onQuality(q)} label={qualityLabel(q)} hint={qualityHint(q)} />
              ))
            : AUDIO_FORMATS.map((f) => (
                <Chip key={f.id} active={p.audioFormat === f.id} onClick={() => p.onAudioFormat(f.id)} label={f.label} hint={f.hint} />
              ))}
        </div>

        <div className="mt-4 flex min-w-0 items-center gap-2 text-[13px]">
          <FolderIcon size={15} className="shrink-0 text-faint" />
          <span className="shrink-0 text-muted">Guardar en</span>
          <span className="min-w-0 truncate font-semibold" title={p.outputDir}>
            {shortPath(p.outputDir)}
          </span>
          <button
            onClick={p.onChooseFolder}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 font-semibold text-ink transition-colors hover:border-accent/60"
          >
            Cambiar
          </button>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-4">
          {p.mode === 'video' ? (
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]" title="Convierte el video a H.264 solo si hace falta, para que CapCut y otros editores lo importen sin problemas.">
              <input
                type="checkbox"
                checked={p.editorCompatible}
                onChange={(e) => p.onEditorCompatible(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <WandIcon size={14} className="text-accent" /> Compatible con editores
                </span>
                <span className="text-faint">Convierte a H.264 si hace falta (CapCut, Premiere…)</span>
              </span>
            </label>
          ) : (
            <span className="text-[13px] text-faint">Se extrae el audio en la mejor calidad disponible.</span>
          )}
          <button
            onClick={p.onDownload}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-white shadow-[0_6px_20px_-6px_rgba(255,91,58,0.6)] transition-colors hover:bg-accent-hover"
          >
            <DownloadIcon size={18} />
            Descargar
          </button>
        </div>
      </div>
    </section>
  )
}

export function MediaSkeleton() {
  return (
    <section className="flex animate-pulse gap-5 rounded-2xl border border-line bg-surface p-4" aria-busy="true" aria-label="Buscando video">
      <div className="aspect-video w-[260px] shrink-0 rounded-xl bg-raised" />
      <div className="flex flex-1 flex-col gap-3 pt-1">
        <div className="h-4 w-3/4 rounded bg-raised" />
        <div className="h-3 w-1/3 rounded bg-raised" />
        <div className="mt-3 h-9 w-56 rounded-xl bg-raised" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-16 rounded-xl bg-raised" />
          ))}
        </div>
      </div>
    </section>
  )
}
