import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioFormat, HistoryItem, Job, MediaInfo, Mode, Settings } from '@shared/types'
import { pickQuality } from '@shared/types'
import { AlertIcon, FolderIcon, Logo, SlidersIcon, XIcon } from './components/Icons'
import { Library } from './components/Library'
import { MediaCard, MediaSkeleton } from './components/MediaCard'
import { Onboarding, STEPS } from './components/Onboarding'
import { QueueList } from './components/QueueList'
import { SettingsDialog } from './components/SettingsDialog'
import { UrlBar } from './components/UrlBar'

const api = window.api
const isUrl = (t: string): boolean => /^https?:\/\/\S+$/i.test(t.trim())

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('video')
  const [quality, setQuality] = useState(1080)
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3')
  const [compat, setCompat] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [tab, setTab] = useState<'queue' | 'library'>('queue')
  const [showSettings, setShowSettings] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const seq = useRef(0)
  const seenClipboard = useRef(new Set<string>())

  const refreshHistory = useCallback(() => void api.listHistory().then(setHistory), [])

  useEffect(() => {
    void api.getSettings().then((s) => {
      setSettings(s)
      setMode(s.defaultMode)
      setAudioFormat(s.audioFormat)
      setCompat(s.editorCompatible)
    })
    void api.listJobs().then(setJobs)
    refreshHistory()
    const offJob = api.onJobUpdate((job) =>
      setJobs((list) => {
        const i = list.findIndex((j) => j.id === job.id)
        if (i === -1) return [job, ...list]
        const copy = list.slice()
        copy[i] = job
        return copy
      })
    )
    // Quitada desde el menú de macOS.
    const offRemoved = api.onJobRemoved((id) => setJobs((list) => list.filter((j) => j.id !== id)))
    const offHistory = api.onHistoryChange(refreshHistory)
    return () => {
      offJob()
      offRemoved()
      offHistory()
    }
  }, [refreshHistory])

  const analyze = useCallback(
    async (target: string) => {
      const id = ++seq.current
      seenClipboard.current.add(target)
      setSuggestion(null)
      setError(null)
      setMedia(null)
      setAnalyzing(true)
      try {
        const info = await api.analyze(target)
        if (id !== seq.current) return
        setMedia(info)
        const s = settings
        setMode(info.qualities.length ? (s?.defaultMode ?? 'video') : 'audio')
        setQuality(pickQuality(info.qualities, s?.defaultQuality ?? 1080))
      } catch (err) {
        if (id === seq.current) setError((err as Error).message)
      } finally {
        if (id === seq.current) setAnalyzing(false)
      }
    },
    [settings]
  )

  // Órdenes del menú de macOS. Se esperan los ajustes para que el análisis use la calidad predeterminada.
  useEffect(() => {
    if (!settings) return
    return api.onCommand((command) => {
      if (command.type === 'settings') return setShowSettings(true)
      setShowSettings(false)
      setUrl(command.url)
      void analyze(command.url)
    })
  }, [settings, analyze])

  // Sugerir el link del portapapeles al volver a la ventana.
  useEffect(() => {
    const check = async () => {
      const clip = await api.readClipboardUrl().catch(() => null)
      if (clip && !seenClipboard.current.has(clip)) setSuggestion(clip)
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  // Ctrl+V (⌘V en Mac) en cualquier parte de la ventana pega el link y lo busca.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const text = e.clipboardData?.getData('text').trim() ?? ''
      if (isUrl(text)) {
        e.preventDefault()
        setUrl(text)
        void analyze(text)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [analyze])

  const pasteFromClipboard = async () => {
    const clip = await api.readClipboardUrl().catch(() => null)
    if (!clip) {
      setError('No hay un link en el portapapeles. Copia el link del video y vuelve a intentarlo.')
      return
    }
    setUrl(clip)
    void analyze(clip)
  }

  const startDownload = async () => {
    if (!media) return
    try {
      await api.addJob({
        url: media.url,
        title: media.title,
        platform: media.platform,
        thumbnail: media.thumbnail,
        mode,
        quality: mode === 'video' ? quality : 0,
        audioFormat,
        editorCompatible: compat,
        outputDir: settings?.outputDir
      })
      setMedia(null)
      setUrl('')
      setTab('queue')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** La carpeta elegida queda como predeterminada para las siguientes descargas. */
  const chooseFolder = async () => {
    const dir = await api.chooseFolder()
    if (dir) await updateSettings({ outputDir: dir })
  }

  const updateSettings = async (patch: Partial<Settings>) => {
    const s = await api.setSettings(patch)
    setSettings(s)
    if (patch.audioFormat) setAudioFormat(patch.audioFormat)
    if (patch.editorCompatible !== undefined) setCompat(patch.editorCompatible)
  }

  const fileActions = {
    onShow: (p: string) => void api.showInFolder(p),
    onOpen: (p: string) => void api.openFile(p),
    onDrag: (p: string) => api.startDrag(p)
  }

  const activeCount = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued').length

  return (
    <div className="flex h-full flex-col">
      {/* Barra de título propia; los botones de ventana los dibuja el sistema (titleBarOverlay en Windows,
          semáforos a la izquierda en macOS). */}
      <header
        className={`drag-region flex h-11 shrink-0 items-center gap-2.5 ${api.platform === 'darwin' ? 'pl-[84px] pr-4' : 'pl-4 pr-[150px]'}`}
      >
        <Logo size={20} />
        <span className="font-display text-[14px] font-semibold tracking-tight">Descargador</span>
        <div className="flex-1" />
        <button
          onClick={() => void api.openOutputDir()}
          className="no-drag flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface hover:text-ink"
        >
          <FolderIcon size={16} /> Carpeta
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="no-drag flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface hover:text-ink"
        >
          <SlidersIcon size={16} /> Ajustes
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[920px] shrink-0 px-6 pt-4">
          <UrlBar
            value={url}
            analyzing={analyzing}
            suggestion={suggestion}
            onChange={(v) => {
              setUrl(v)
              if (!v) setError(null)
            }}
            onSubmit={(u) => void analyze(u)}
            onPasteClick={() => void pasteFromClipboard()}
            onClear={() => {
              seq.current++
              setUrl('')
              setMedia(null)
              setError(null)
              setAnalyzing(false)
            }}
            onUseSuggestion={() => {
              if (!suggestion) return
              setUrl(suggestion)
              void analyze(suggestion)
            }}
            onDismissSuggestion={() => {
              if (suggestion) seenClipboard.current.add(suggestion)
              setSuggestion(null)
            }}
          />

          <div className="mt-4">
            {error && (
              <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-[13.5px]">
                <AlertIcon size={18} className="mt-0.5 shrink-0 text-bad" />
                <p className="flex-1">{error}</p>
                <button onClick={() => setError(null)} className="text-muted hover:text-ink" aria-label="Cerrar aviso">
                  <XIcon size={16} />
                </button>
              </div>
            )}
            {analyzing && <MediaSkeleton />}
            {!analyzing && media && (
              <MediaCard
                media={media}
                mode={mode}
                quality={quality}
                audioFormat={audioFormat}
                editorCompatible={compat}
                onMode={setMode}
                onQuality={setQuality}
                onAudioFormat={setAudioFormat}
                onEditorCompatible={setCompat}
                onDownload={() => void startDownload()}
                outputDir={settings?.outputDir ?? ''}
                onChooseFolder={() => void chooseFolder()}
              />
            )}
            {!analyzing && !media && !error && (
              <ol className="grid grid-cols-3 gap-3">
                {STEPS.map(({ icon: Icon, title, text }, i) => (
                  <li key={title} className="flex gap-3 rounded-2xl border border-dashed border-line p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[13px] font-bold text-accent">
                      {i + 1}
                    </span>
                    <div>
                      <p className="flex items-center gap-1.5 font-semibold">
                        {title} <Icon size={15} className="text-faint" />
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-muted">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <section className="mx-auto mt-5 flex min-h-0 w-full max-w-[920px] flex-1 flex-col px-6">
          <div role="tablist" className="flex shrink-0 gap-1 border-b border-line">
            {(
              [
                ['queue', 'Descargas', activeCount],
                ['library', 'Biblioteca', history.length]
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id)
                  if (id === 'library') refreshHistory()
                }}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 font-semibold transition-colors ${
                  tab === id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 text-[11.5px] tabular-nums ${tab === id ? 'bg-accent/15 text-accent' : 'bg-raised text-muted'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
            <p className="ml-auto self-center pb-2 text-[12px] text-faint">Arrastra los archivos listos directo a CapCut</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-3 pr-1">
            {tab === 'queue' ? (
              <QueueList
                jobs={jobs}
                onCancel={(id) => void api.cancelJob(id)}
                onRetry={(id) => void api.retryJob(id)}
                onDismiss={(id) => {
                  void api.dismissJob(id)
                  setJobs((l) => l.filter((j) => j.id !== id))
                }}
                {...fileActions}
              />
            ) : (
              <Library
                items={history}
                onRemove={(id) => void api.removeHistory(id).then(refreshHistory)}
                {...fileActions}
              />
            )}
          </div>
        </section>
      </main>

      {showSettings && settings && (
        <SettingsDialog settings={settings} onChange={(p) => void updateSettings(p)} onClose={() => setShowSettings(false)} />
      )}
      {settings && !settings.onboardingDone && <Onboarding onDone={() => void updateSettings({ onboardingDone: true })} />}
    </div>
  )
}
