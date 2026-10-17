import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AudioFormat, CookieBrowser, EngineInfo, Mode, Settings } from '@shared/types'
import { QUALITY_STEPS } from '@shared/types'
import { qualityLabel } from '../lib/format'
import { FolderIcon, RetryIcon, ShieldIcon, Spinner, XIcon } from './Icons'

interface Props {
  settings: Settings
  onChange(patch: Partial<Settings>): void
  onClose(): void
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const isMac = window.api.platform === 'darwin'

const selectCls =
  'h-9 rounded-lg border border-line bg-bg px-3 text-ink focus:border-accent/60 focus:outline-none [&>option]:bg-surface'

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [updating, setUpdating] = useState(false)
  const [engineMsg, setEngineMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [version, setVersion] = useState('')
  const [openAtLogin, setOpenAtLogin] = useState(false)

  useEffect(() => {
    void window.api.engineInfo().then(setEngine)
    void window.api.appVersion().then(setVersion)
    if (isMac) void window.api.getOpenAtLogin().then(setOpenAtLogin)
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chooseFolder = async () => {
    const dir = await window.api.chooseFolder()
    if (dir) onChange({ outputDir: dir })
  }

  const updateEngine = async () => {
    setUpdating(true)
    setEngineMsg(null)
    try {
      const r = await window.api.updateEngine()
      setEngineMsg({ ok: r.ok, text: r.message })
      if (r.version) setEngine((e) => (e ? { ...e, version: r.version! } : e))
    } catch (err) {
      setEngineMsg({ ok: false, text: (err as Error).message })
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl focus:outline-none"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="settings-title" className="font-display text-[17px] font-semibold">
            Ajustes
          </h2>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-ink" aria-label="Cerrar">
            <XIcon size={18} />
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-5">
          <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-faint">Descargas</h3>
          <div className="divide-y divide-line">
            <Row label="Carpeta de descargas" hint={<span className="break-all">{settings.outputDir}</span>}>
              <button onClick={chooseFolder} className="flex h-9 items-center gap-2 rounded-lg bg-raised px-3 font-semibold hover:bg-line">
                <FolderIcon size={16} /> Cambiar
              </button>
            </Row>
            <Row label="Tipo predeterminado">
              <select className={selectCls} value={settings.defaultMode} onChange={(e) => onChange({ defaultMode: e.target.value as Mode })}>
                <option value="video">Video</option>
                <option value="audio">Solo audio</option>
              </select>
            </Row>
            <Row label="Calidad de video predeterminada" hint="Si el video no la tiene, se usa la más cercana por debajo.">
              <select
                className={selectCls}
                value={settings.defaultQuality}
                onChange={(e) => onChange({ defaultQuality: Number(e.target.value) })}
              >
                {QUALITY_STEPS.map((q) => (
                  <option key={q} value={q}>
                    {qualityLabel(q)}
                    {q >= 1440 ? ` (${q}p)` : ''}
                  </option>
                ))}
                <option value={0}>La mejor disponible</option>
              </select>
            </Row>
            <Row label="Formato de audio predeterminado">
              <select className={selectCls} value={settings.audioFormat} onChange={(e) => onChange({ audioFormat: e.target.value as AudioFormat })}>
                <option value="mp3">MP3 · compatible</option>
                <option value="m4a">M4A · ligero</option>
                <option value="wav">WAV · sin pérdida</option>
              </select>
            </Row>
            <Row
              label="Compatible con editores"
              hint="Convierte a H.264 los videos en VP9/AV1 (YouTube en 2K/4K) para que CapCut los importe sin problemas."
            >
              <input
                type="checkbox"
                checked={settings.editorCompatible}
                onChange={(e) => onChange({ editorCompatible: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-accent)]"
                aria-label="Compatible con editores"
              />
            </Row>
          </div>

          <h3 className="mt-6 text-[12px] font-semibold uppercase tracking-wider text-faint">Acceso a contenido</h3>
          <div className="divide-y divide-line">
            <Row
              label="Usar cookies de mi navegador"
              hint="Solo si Instagram o YouTube piden iniciar sesión o verificar tu edad. Las cookies se leen en tu equipo y no salen de él. En Windows, Firefox es el más confiable; Chrome y Edge pueden fallar por su cifrado."
            >
              <select
                className={selectCls}
                value={settings.cookiesBrowser}
                onChange={(e) => onChange({ cookiesBrowser: e.target.value as CookieBrowser })}
              >
                <option value="none">No usar</option>
                <option value="firefox">Firefox</option>
                <option value="edge">Edge</option>
                <option value="chrome">Chrome</option>
              </select>
            </Row>
          </div>

          {isMac && (
            <>
              <h3 className="mt-6 text-[12px] font-semibold uppercase tracking-wider text-faint">Barra de menú</h3>
              <div className="divide-y divide-line">
                <Row
                  label="Mostrar en la barra de menú"
                  hint="Descarga el link que copiaste sin abrir la ventana y ve el progreso arriba. Al cerrar la ventana, Descargador sigue ahí y las descargas continúan."
                >
                  <input
                    type="checkbox"
                    checked={settings.menuBar}
                    onChange={(e) => onChange({ menuBar: e.target.checked })}
                    className="h-5 w-5 accent-[var(--color-accent)]"
                    aria-label="Mostrar en la barra de menú"
                  />
                </Row>
                <Row
                  label="Abrir al iniciar sesión"
                  hint={settings.menuBar ? 'Arranca solo en la barra de menú, sin abrir la ventana.' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={openAtLogin}
                    onChange={(e) => void window.api.setOpenAtLogin(e.target.checked).then(setOpenAtLogin)}
                    className="h-5 w-5 accent-[var(--color-accent)]"
                    aria-label="Abrir al iniciar sesión"
                  />
                </Row>
              </div>
            </>
          )}

          <h3 className="mt-6 text-[12px] font-semibold uppercase tracking-wider text-faint">Motor de descarga</h3>
          <div className="divide-y divide-line">
            <Row
              label="Actualizar motor"
              hint={
                <>
                  Versión {engine?.version ?? '…'}. Las plataformas cambian seguido; si algo deja de bajar, actualiza.
                  {engineMsg && <span className={`mt-1 block ${engineMsg.ok ? 'text-ok' : 'text-bad'}`}>{engineMsg.text}</span>}
                </>
              }
            >
              <button
                onClick={updateEngine}
                disabled={updating}
                className="flex h-9 items-center gap-2 rounded-lg bg-raised px-3 font-semibold hover:bg-line disabled:opacity-60"
              >
                {updating ? <Spinner size={16} /> : <RetryIcon size={16} />}
                {updating ? 'Actualizando' : 'Buscar actualización'}
              </button>
            </Row>
            <Row label="Revisar actualizaciones del motor cada semana" hint="Es la única conexión que la app hace por su cuenta (a GitHub).">
              <input
                type="checkbox"
                checked={settings.autoUpdateEngine}
                onChange={(e) => onChange({ autoUpdateEngine: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-accent)]"
                aria-label="Revisar actualizaciones del motor cada semana"
              />
            </Row>
          </div>

          <div className="mt-6 flex gap-3 rounded-xl border border-line bg-bg p-4 text-[13px] text-muted">
            <ShieldIcon size={20} className="mt-0.5 shrink-0 text-ok" />
            <p>
              <span className="font-semibold text-ink">Todo pasa en tu computadora.</span> Sin cuentas, sin anuncios y sin
              telemetría: la app solo se conecta a la plataforma del link que pegas. Descarga únicamente contenido propio o
              que tengas permiso de usar, y respeta los derechos de autor y los términos de cada plataforma.
              <span className="mt-2 block text-faint">
                Descargador {version} · Usa yt-dlp y FFmpeg (licencias incluidas en la carpeta de la app).
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
