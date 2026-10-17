import type { DragEvent, ReactNode } from 'react'
import type { Job } from '@shared/types'
import { formatEta, formatSpeed, platformLabel, qualityLabel } from '../lib/format'
import { AlertIcon, CheckIcon, FilmIcon, FolderIcon, GripIcon, MusicIcon, RetryIcon, XIcon } from './Icons'

interface Props {
  jobs: Job[]
  onCancel(id: string): void
  onRetry(id: string): void
  onDismiss(id: string): void
  onShow(path: string): void
  onOpen(path: string): void
  onDrag(path: string): void
}

function IconButton({ title, onClick, children }: { title: string; onClick(): void; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-ink">
      {children}
    </button>
  )
}

function describe(job: Job): string {
  const r = job.request
  return r.mode === 'video' ? `Video ${r.quality ? qualityLabel(r.quality) : ''}`.trim() : `Audio ${r.audioFormat.toUpperCase()}`
}

export function QueueList(p: Props) {
  if (!p.jobs.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 py-10 text-center text-muted">
        <p className="font-semibold text-ink">Aún no hay descargas en esta sesión</p>
        <p className="text-[13px]">Pega un link arriba para empezar. Lo que bajes también queda en la Biblioteca.</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {p.jobs.map((job) => {
        const done = job.status === 'done' && job.filePath
        const active = job.status === 'downloading' || job.status === 'processing'
        const indeterminate = job.status === 'processing' && job.stage !== 'Optimizando para edición'
        const onDragStart = (e: DragEvent) => {
          e.preventDefault()
          if (job.filePath) p.onDrag(job.filePath)
        }

        return (
          <li
            key={job.id}
            draggable={!!done}
            onDragStart={done ? onDragStart : undefined}
            onDoubleClick={done ? () => p.onOpen(job.filePath!) : undefined}
            className={`group flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 pr-2 ${
              done ? 'cursor-grab hover:border-accent/50 active:cursor-grabbing' : ''
            }`}
            title={done ? 'Arrastra este archivo a CapCut o a cualquier editor' : undefined}
          >
            <div className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-lg bg-raised">
              {job.request.thumbnail ? (
                <img src={job.request.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center text-faint">
                  {job.request.mode === 'video' ? <FilmIcon size={20} /> : <MusicIcon size={20} />}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold" title={job.request.title}>
                {job.request.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">
                <span>{platformLabel(job.request.platform)}</span>
                <span className="text-faint">·</span>
                <span>{describe(job)}</span>
                <span className="text-faint">·</span>
                {job.status === 'done' && (
                  <span className="flex items-center gap-1 font-semibold text-ok">
                    <CheckIcon size={13} /> Listo — arrástralo a tu editor
                  </span>
                )}
                {job.status === 'error' && (
                  <span className="flex min-w-0 items-center gap-1 text-bad" title={job.error}>
                    <AlertIcon size={13} className="shrink-0" />
                    <span className="truncate">{job.error}</span>
                  </span>
                )}
                {job.status === 'canceled' && <span className="text-faint">Cancelado</span>}
                {job.status === 'queued' && <span>En espera</span>}
                {active && (
                  <span className="tabular-nums">
                    {job.stage}
                    {!indeterminate && ` · ${Math.floor(job.percent)}%`}
                    {job.speed ? ` · ${formatSpeed(job.speed)}` : ''}
                    {job.eta ? ` · ${formatEta(job.eta)}` : ''}
                  </span>
                )}
              </div>
              {(active || job.status === 'queued') && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(job.percent)} aria-valuemin={0} aria-valuemax={100}>
                  {indeterminate || job.status === 'queued' ? (
                    <div className={`h-full w-2/5 rounded-full ${job.status === 'queued' ? 'bg-line-strong' : 'bar-indeterminate bg-accent'}`} />
                  ) : (
                    <div
                      className={`h-full rounded-full transition-[width] duration-200 ${job.status === 'processing' ? 'bg-amber-400' : 'bg-accent'}`}
                      style={{ width: `${Math.max(2, job.percent)}%` }}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center">
              {done && (
                <>
                  <span className="mr-1 hidden items-center text-faint group-hover:flex" aria-hidden="true">
                    <GripIcon size={16} />
                  </span>
                  <IconButton title="Mostrar en la carpeta" onClick={() => p.onShow(job.filePath!)}>
                    <FolderIcon size={17} />
                  </IconButton>
                </>
              )}
              {(job.status === 'error' || job.status === 'canceled') && (
                <IconButton title="Reintentar" onClick={() => p.onRetry(job.id)}>
                  <RetryIcon size={17} />
                </IconButton>
              )}
              {active || job.status === 'queued' ? (
                <IconButton title="Cancelar" onClick={() => p.onCancel(job.id)}>
                  <XIcon size={17} />
                </IconButton>
              ) : (
                <IconButton title="Quitar de la lista" onClick={() => p.onDismiss(job.id)}>
                  <XIcon size={17} />
                </IconButton>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
