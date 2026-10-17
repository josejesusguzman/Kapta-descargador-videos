// Cola de descargas: hasta 2 en paralelo, con cancelar, reintentar y post-proceso para edición.
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { DownloadRequest, Job } from '@shared/types'
import { needsRecode, probe, recodeForEditing } from './ffmpeg'
import { addHistory, fileSize, getSettings } from './store'
import { download, UserError } from './ytdlp'

const CONCURRENCY = 2

export class JobQueue extends EventEmitter<{ update: [Job]; done: [Job]; history: [] }> {
  private jobs = new Map<string, Job>()
  private controllers = new Map<string, AbortController>()
  private lastEmit = new Map<string, number>()

  list(): Job[] {
    return [...this.jobs.values()]
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  activeCount(): number {
    return this.list().filter((j) => j.status === 'downloading' || j.status === 'processing').length
  }

  add(request: DownloadRequest): Job {
    const job: Job = {
      id: randomUUID(),
      request,
      status: 'queued',
      percent: 0,
      stage: 'En espera',
      createdAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.emitUpdate(job, true)
    this.pump()
    return job
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.patch(job, { status: 'canceled', stage: 'Cancelado' }, true)
      return
    }
    this.controllers.get(id)?.abort()
  }

  retry(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !['error', 'canceled'].includes(job.status)) return
    this.patch(job, { status: 'queued', percent: 0, stage: 'En espera', error: undefined, speed: undefined, eta: undefined }, true)
    this.pump()
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id)
    if (job && !['downloading', 'processing'].includes(job.status)) this.jobs.delete(id)
  }

  private pump(): void {
    while (this.activeCount() < CONCURRENCY) {
      const next = this.list().find((j) => j.status === 'queued')
      if (!next) return
      void this.run(next)
    }
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    const { signal } = controller
    const settings = getSettings()
    let filePath: string | undefined
    this.patch(job, { status: 'downloading', stage: 'Preparando', percent: 0 }, true)

    try {
      filePath = await download(
        job.id,
        job.request,
        job.request.outputDir || settings.outputDir,
        settings.cookiesBrowser,
        {
          onProgress: (percent, stage, speed, eta) => this.patch(job, { percent, stage, speed, eta }),
          onStage: (stage) => this.patch(job, { status: 'processing', stage, percent: 100, speed: undefined, eta: undefined }, true)
        },
        signal
      )

      if (job.request.mode === 'video' && job.request.editorCompatible) {
        const info = await probe(filePath)
        if (needsRecode(info.vcodec)) {
          this.patch(job, { status: 'processing', stage: 'Optimizando para edición', percent: 0, speed: undefined, eta: undefined }, true)
          await recodeForEditing(filePath, info, (percent) => this.patch(job, { percent }), signal)
        }
      }

      this.patch(job, { status: 'done', stage: 'Listo', percent: 100, filePath, speed: undefined, eta: undefined }, true)
      addHistory(
        {
          id: job.id,
          title: job.request.title,
          platform: job.request.platform,
          mode: job.request.mode,
          filePath,
          size: fileSize(filePath),
          createdAt: Date.now()
        },
        job.request.thumbnail
      )
      this.emit('history')
      this.emit('done', job)
    } catch (err) {
      if (signal.aborted) {
        // Si se canceló durante la optimización, no dejar el archivo a medias de procesar.
        if (filePath) rmSync(filePath, { force: true })
        this.patch(job, { status: 'canceled', stage: 'Cancelado', speed: undefined, eta: undefined }, true)
      } else {
        const message = err instanceof UserError ? err.message : `Error inesperado: ${(err as Error).message}`
        this.patch(job, { status: 'error', stage: 'Error', error: message, speed: undefined, eta: undefined }, true)
      }
    } finally {
      this.controllers.delete(job.id)
      this.pump()
    }
  }

  private patch(job: Job, changes: Partial<Job>, force = false): void {
    Object.assign(job, changes)
    this.emitUpdate(job, force)
  }

  /** Limita los eventos de progreso a ~8 por segundo por descarga. */
  private emitUpdate(job: Job, force: boolean): void {
    const now = Date.now()
    if (!force && now - (this.lastEmit.get(job.id) ?? 0) < 120) return
    this.lastEmit.set(job.id, now)
    this.emit('update', { ...job })
  }
}
