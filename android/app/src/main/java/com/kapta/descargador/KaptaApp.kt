// Estado de la app compartido por la interfaz (KaptaPlugin) y el servicio de descargas.
package com.kapta.descargador

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import com.kapta.descargador.core.Job

class KaptaApp : Application() {
    lateinit var store: Store
        private set
    lateinit var cookies: Cookies
        private set
    lateinit var queue: JobQueue
        private set

    @Volatile var engineUpdating = false

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        cookies = Cookies(this)
        queue = JobQueue(this, store, cookies)
        createChannels()
        Engine.cleanLeftovers(this)
        Thread({ Engine.init(this) }, "motor").start()

        // El servicio en primer plano mantiene viva la app mientras haya descargas, aunque se cierre la interfaz.
        queue.addListener(object : JobQueue.Listener {
            override fun onUpdate(job: Job) {
                if (job.status == "queued" || job.active) DownloadService.ensureRunning(this@KaptaApp)
            }
            override fun onDone(job: Job) = Notifications.done(this@KaptaApp, job)
            override fun onFailed(job: Job) = Notifications.failed(this@KaptaApp, job)
        })
        scheduleEngineCheck()
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(Notifications.CHANNEL_PROGRESS, "Descargas en curso", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(Notifications.CHANNEL_DONE, "Descargas terminadas", NotificationManager.IMPORTANCE_DEFAULT).apply {
                setSound(null, null)
            }
        )
    }

    /** Revisión semanal del motor (si está activada), en segundo plano y sin molestar. Como en escritorio. */
    private fun scheduleEngineCheck() {
        val s = store.settings()
        if (!s.optBoolean("autoUpdateEngine", true) || System.currentTimeMillis() - s.optLong("lastEngineCheck") < WEEK) return
        Thread({
            Thread.sleep(15000)
            if (queue.activeCount() == 0) runEngineUpdate()
        }, "revisar-motor").start()
    }

    /** Actualiza el motor si no hay descargas en curso. Devuelve el resultado para Ajustes. */
    @Synchronized
    fun runEngineUpdate(): org.json.JSONObject {
        if (engineUpdating) return org.json.JSONObject().put("ok", false).put("message", "Ya se está actualizando el motor.")
        if (queue.activeCount() > 0) {
            return org.json.JSONObject().put("ok", false).put("message", "Espera a que terminen las descargas en curso para actualizar el motor.")
        }
        engineUpdating = true
        try {
            val result = Engine.update(this)
            store.updateSettings(org.json.JSONObject().put("lastEngineCheck", System.currentTimeMillis()))
            return result
        } finally {
            engineUpdating = false
        }
    }

    companion object {
        private const val WEEK = 7L * 24 * 60 * 60 * 1000

        fun openAppIntent(app: Application): Intent =
            Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
