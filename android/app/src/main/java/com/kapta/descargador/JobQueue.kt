// Cola de descargas: hasta 2 en paralelo, con cancelar, reintentar y post-proceso para edición. Port de src/main/queue.ts.
// Vive en el proceso de la app (no en el WebView); DownloadService la mantiene viva mientras haya descargas.
package com.kapta.descargador

import android.content.Context
import com.kapta.descargador.core.DownloadRequest
import com.kapta.descargador.core.Job
import com.kapta.descargador.core.UserError
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class JobQueue(private val ctx: Context, private val store: Store, private val cookies: Cookies) {
    interface Listener {
        fun onUpdate(job: Job) {}
        fun onRemoved(id: String) {}
        fun onHistory() {}
        fun onDone(job: Job) {}
        fun onFailed(job: Job) {}
    }

    private class Control {
        val canceled = AtomicBoolean(false)
        @Volatile var process: Process? = null
    }

    private val jobs = LinkedHashMap<String, Job>()
    private val controls = HashMap<String, Control>()
    private val lastEmit = HashMap<String, Long>()
    private val listeners = CopyOnWriteArrayList<Listener>()

    fun addListener(l: Listener) = listeners.add(l)
    fun removeListener(l: Listener) = listeners.remove(l)

    @Synchronized fun list(): List<Job> = jobs.values.map { it.copy() }

    @Synchronized fun activeCount(): Int = jobs.values.count { it.active }

    /** Descargas en curso o en espera (para el servicio y la notificación). */
    @Synchronized fun pendingCount(): Int = jobs.values.count { it.active || it.status == "queued" }

    @Synchronized
    fun add(request: DownloadRequest): Job {
        val job = Job(id = UUID.randomUUID().toString(), request = request)
        jobs[job.id] = job
        emitUpdate(job, true)
        pump()
        return job.copy()
    }

    @Synchronized
    fun cancel(id: String) {
        val job = jobs[id] ?: return
        if (job.status == "queued") {
            patch(job, true) { status = "canceled"; stage = "Cancelado" }
            return
        }
        val c = controls[id] ?: return
        c.canceled.set(true)
        Engine.cancel(id)
        c.process?.destroy()
    }

    @Synchronized
    fun retry(id: String) {
        val job = jobs[id] ?: return
        if (job.status != "error" && job.status != "canceled") return
        patch(job, true) { status = "queued"; percent = 0.0; stage = "En espera"; error = null; loginSite = null; speed = null; eta = null }
        pump()
    }

    @Synchronized
    fun dismiss(id: String) {
        val job = jobs[id] ?: return
        if (job.active) return
        jobs.remove(id)
        listeners.forEach { it.onRemoved(id) }
    }

    @Synchronized
    private fun pump() {
        while (activeCount() < CONCURRENCY) {
            val next = jobs.values.firstOrNull { it.status == "queued" } ?: return
            val control = Control()
            controls[next.id] = control
            patch(next, true) { status = "downloading"; stage = "Preparando"; percent = 0.0 }
            Thread({ run(next, control) }, "descarga-${next.id.take(8)}").start()
        }
    }

    private fun run(job: Job, control: Control) {
        val req = job.request
        val isCanceled = { control.canceled.get() }
        try {
            val file = Engine.download(ctx, job.id, req, cookies, object : Engine.DownloadCallbacks {
                override fun onProgress(percent: Double, stage: String, speed: Double?, eta: Double?) =
                    patch(job) { this.percent = percent; this.stage = stage; this.speed = speed; this.eta = eta }

                override fun onStage(stage: String) =
                    patch(job, true) { status = "processing"; this.stage = stage; percent = 100.0; speed = null; eta = null }
            }, isCanceled)

            if (req.mode == "video" && req.editorCompatible) {
                val info = Ffmpeg.probe(ctx, file)
                if (Ffmpeg.needsRecode(info.vcodec)) {
                    patch(job, true) { status = "processing"; stage = "Optimizando para edición"; percent = 0.0; speed = null; eta = null }
                    Ffmpeg.recodeForEditing(ctx, file, info, { p -> patch(job) { percent = p } }, isCanceled) { control.process = it }
                }
            }
            if (isCanceled()) throw CanceledError()

            patch(job, true) { status = "processing"; stage = "Guardando en la galería"; percent = 100.0; speed = null; eta = null }
            val saved = Gallery.save(ctx, file, req.mode == "audio")
            store.addHistory(job.id, req.title, req.platform, req.mode, saved, req.thumbnail)
            patch(job, true) { status = "done"; stage = "Listo"; percent = 100.0; filePath = saved.path; speed = null; eta = null }
            listeners.forEach { it.onHistory() }
            listeners.forEach { it.onDone(job.copy()) }
        } catch (e: Exception) {
            if (e is CanceledError || isCanceled()) {
                patch(job, true) { status = "canceled"; stage = "Cancelado"; speed = null; eta = null }
            } else {
                val message = if (e is UserError) e.message ?: "Error" else "Error inesperado: ${e.message}"
                patch(job, true) { status = "error"; stage = "Error"; error = message; loginSite = (e as? UserError)?.loginSite; speed = null; eta = null }
                listeners.forEach { it.onFailed(job.copy()) }
            }
        } finally {
            // Si se canceló a medias (o falló), no queda nada en la carpeta privada.
            Engine.stagingDir(ctx, job.id).deleteRecursively()
            synchronized(this) {
                controls.remove(job.id)
                pump()
            }
        }
    }

    private fun patch(job: Job, force: Boolean = false, change: Job.() -> Unit) {
        synchronized(this) { job.change() }
        emitUpdate(job, force)
    }

    /** Limita los eventos de progreso a ~8 por segundo por descarga. */
    private fun emitUpdate(job: Job, force: Boolean) {
        val snapshot: Job
        synchronized(this) {
            val now = System.currentTimeMillis()
            if (!force && now - (lastEmit[job.id] ?: 0) < 120) return
            lastEmit[job.id] = now
            snapshot = job.copy()
        }
        listeners.forEach { it.onUpdate(snapshot) }
    }

    companion object {
        private const val CONCURRENCY = 2
    }
}
