import { useEffect, useRef } from 'react'
import { isAndroid } from '../lib/platform'
import { ArrowRightIcon, ClipboardIcon, LinkIcon, Spinner, XIcon } from './Icons'

interface Props {
  value: string
  analyzing: boolean
  suggestion: string | null
  onChange(value: string): void
  onSubmit(url: string): void
  onPasteClick(): void
  onClear(): void
  onUseSuggestion(): void
  onDismissSuggestion(): void
}

const shortUrl = (u: string): string => u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) + (u.length > 70 ? '…' : '')

export function UrlBar(p: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // En Android, enfocar al abrir sacaría el teclado sin que se pida.
  useEffect(() => {
    if (!isAndroid) inputRef.current?.focus()
  }, [])

  return (
    <div>
      <form
        className="group flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 pl-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors focus-within:border-accent/60"
        onSubmit={(e) => {
          e.preventDefault()
          if (p.value.trim()) p.onSubmit(p.value.trim())
        }}
      >
        <LinkIcon size={20} className="shrink-0 text-faint group-focus-within:text-accent" />
        <input
          ref={inputRef}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim()
            if (/^https?:\/\/\S+$/i.test(text)) {
              e.preventDefault()
              p.onChange(text)
              p.onSubmit(text)
            }
          }}
          placeholder="Pega aquí el link de YouTube, TikTok, Instagram…"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
          aria-label="Link del video"
        />
        {p.value && !p.analyzing && (
          <button
            type="button"
            onClick={p.onClear}
            className="rounded-lg p-2 text-faint hover:bg-raised hover:text-ink"
            title="Borrar"
          >
            <XIcon size={16} />
          </button>
        )}
        {p.value.trim() ? (
          <button
            type="submit"
            disabled={p.analyzing}
            className="flex h-11 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-70"
          >
            {p.analyzing ? <Spinner size={16} /> : <ArrowRightIcon size={16} />}
            {p.analyzing ? 'Buscando' : 'Buscar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onPasteClick}
            className="flex h-11 items-center gap-2 rounded-xl bg-raised px-5 font-semibold text-ink transition-colors hover:bg-line"
          >
            <ClipboardIcon size={16} />
            Pegar
          </button>
        )}
      </form>

      {p.suggestion && !p.value && (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-muted">
          <span>¿Usar el link que copiaste?</span>
          <button
            onClick={p.onUseSuggestion}
            className="max-w-[60%] truncate rounded-full border border-line bg-surface px-3 py-1 text-ink hover:border-accent/60"
            title={p.suggestion}
          >
            {shortUrl(p.suggestion)}
          </button>
          <button onClick={p.onDismissSuggestion} className="rounded-full p-1 text-faint hover:text-ink" title="Ignorar">
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
