// Servicio en primer plano mientras haya descargas: con la notificación de progreso, Android no detiene la app
// aunque se cierre la interfaz o se apague la pantalla. Se detiene solo cuando la cola queda vacía.
package com.kapta.descargador

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.kapta.descargador.core.Job

class DownloadService : Service() {
    private val app get() = application as KaptaApp
    private var lastNotify = 0L

    private val listener = object : JobQueue.Listener {
        override fun onUpdate(job: Job) = refresh()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        val notification = build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(Notifications.ID_PROGRESS, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(Notifications.ID_PROGRESS, notification)
        }
        app.queue.addListener(listener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        refresh()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        app.queue.removeListener(listener)
        running = false
        super.onDestroy()
    }

    /** Android 15 limita el tiempo de este tipo de servicio; si se agota, se detiene sin cerrar la app. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    private fun refresh() {
        if (app.queue.pendingCount() == 0) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastNotify < 1000) return
        lastNotify = now
        getSystemService(NotificationManager::class.java).notify(Notifications.ID_PROGRESS, build())
    }

    private fun build(): Notification {
        val jobs = app.queue.list().filter { it.active || it.status == "queued" }
        val current = jobs.firstOrNull { it.active }
        val title = when {
            jobs.size > 1 -> "Descargando ${jobs.size} archivos"
            current != null -> current.request.title
            else -> "Preparando descarga"
        }
        val text = current?.let { "${it.stage} · ${it.percent.toInt()}%" } ?: "En espera"
        val open = PendingIntent.getActivity(this, 0, KaptaApp.openAppIntent(application), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, Notifications.CHANNEL_PROGRESS)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, current?.percent?.toInt() ?: 0, current == null || current.status == "processing" && current.stage != "Optimizando para edición")
            .build()
    }

    companion object {
        @Volatile private var running = false

        fun ensureRunning(ctx: Context) {
            if (running) return
            running = true
            try {
                ctx.startForegroundService(Intent(ctx, DownloadService::class.java))
            } catch (_: Exception) {
                // Android no deja iniciarlo con la app en segundo plano: la descarga sigue mientras la app viva.
                running = false
            }
        }
    }
}

object Notifications {
    const val CHANNEL_PROGRESS = "descargas"
    const val CHANNEL_DONE = "listas"
    const val ID_PROGRESS = 1

    private fun notify(app: KaptaApp, job: Job, title: String, text: String) {
        val open = PendingIntent.getActivity(app, 0, KaptaApp.openAppIntent(app), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(app, CHANNEL_DONE)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        app.getSystemService(NotificationManager::class.java).notify(job.id.hashCode(), n)
    }

    fun done(app: KaptaApp, job: Job) {
        if (MainActivity.visible) return
        notify(app, job, "Descarga lista", job.request.title)
    }

    fun failed(app: KaptaApp, job: Job) {
        if (MainActivity.visible) return
        notify(app, job, "No se pudo descargar", job.error ?: job.request.title)
    }
}
