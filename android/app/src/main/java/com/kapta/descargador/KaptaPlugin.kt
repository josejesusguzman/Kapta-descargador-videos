// Puente entre la interfaz (src/mobile/api.ts) y la parte nativa. Cada método equivale a un canal IPC de escritorio
// (src/main/index.ts). Capacitor ejecuta los métodos en un solo hilo: lo que tarda (analizar, actualizar) va aparte.
package com.kapta.descargador

import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.kapta.descargador.core.DownloadRequest
import com.kapta.descargador.core.Job
import com.kapta.descargador.core.Sites
import com.kapta.descargador.core.UserError
import org.json.JSONObject
import java.util.concurrent.Executors

@CapacitorPlugin(name = "Kapta")
class KaptaPlugin : Plugin() {
    private val app get() = context.applicationContext as KaptaApp
    private val background = Executors.newCachedThreadPool()
    private var askedNotifications = false

    private val queueListener = object : JobQueue.Listener {
        override fun onUpdate(job: Job) = notifyListeners("jobUpdate", js(job.toJson()))
        override fun onRemoved(id: String) = notifyListeners("jobRemoved", JSObject().put("id", id))
        override fun onHistory() = notifyListeners("historyChanged", JSObject())
    }

    override fun load() {
        app.queue.addListener(queueListener)
    }

    override fun handleOnDestroy() {
        app.queue.removeListener(queueListener)
        CommandBus.detach()
        background.shutdown()
    }

    private fun js(o: JSONObject): JSObject = JSObject.fromJSONObject(o)

    /** Errores con mensaje limpio, como en escritorio; los de sesión llevan el sitio para ofrecer iniciarla. */
    private fun fail(call: PluginCall, e: Throwable) {
        if (e is UserError) {
            if (e.loginSite != null) call.reject(e.message, "LOGIN_REQUIRED", JSObject().put("loginSite", e.loginSite))
            else call.reject(e.message)
        } else {
            call.reject("Error inesperado: ${e.message}")
        }
    }

    private fun async(call: PluginCall, work: () -> JSObject?) {
        background.execute {
            try {
                val result = work()
                if (result != null) call.resolve(result) else call.resolve()
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    private fun sync(call: PluginCall, work: () -> JSObject?) {
        try {
            val result = work()
            if (result != null) call.resolve(result) else call.resolve()
        } catch (e: Throwable) {
            fail(call, e)
        }
    }

    // ---------- Descargas ----------

    @PluginMethod
    fun analyze(call: PluginCall) = async(call) { js(Engine.analyze(context, call.getString("url") ?: "", app.cookies)) }

    @PluginMethod
    fun addJob(call: PluginCall) = sync(call) {
        val job = app.queue.add(DownloadRequest.sanitize(call.getObject("request")))
        askForNotifications()
        js(job.toJson())
    }

    /** Android 13+: el permiso de notificaciones se pide con la primera descarga, no al abrir la app. */
    private fun askForNotifications() {
        if (askedNotifications || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        askedNotifications = true
        val activity = activity ?: return
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS) }
        }
    }

    @PluginMethod
    fun cancelJob(call: PluginCall) = sync(call) { app.queue.cancel(call.getString("id") ?: ""); null }

    @PluginMethod
    fun retryJob(call: PluginCall) = sync(call) { app.queue.retry(call.getString("id") ?: ""); null }

    @PluginMethod
    fun dismissJob(call: PluginCall) = sync(call) { app.queue.dismiss(call.getString("id") ?: ""); null }

    @PluginMethod
    fun listJobs(call: PluginCall) = sync(call) { JSObject().put("jobs", JSArray(app.queue.list().map { it.toJson() })) }

    // ---------- Biblioteca y ajustes ----------

    @PluginMethod
    fun listHistory(call: PluginCall) = async(call) { JSObject().put("items", app.store.listHistory()) }

    @PluginMethod
    fun removeHistory(call: PluginCall) = sync(call) { app.store.removeHistory(call.getString("id") ?: ""); null }

    @PluginMethod
    fun getSettings(call: PluginCall) = sync(call) { js(app.store.settings()) }

    @PluginMethod
    fun setSettings(call: PluginCall) = sync(call) { js(app.store.updateSettings(call.getObject("patch") ?: JSObject())) }

    /** Abre el archivo con otra app (CapCut, la galería, un reproductor…); Android pregunta con cuál. */
    @PluginMethod
    fun openFile(call: PluginCall) = sync(call) {
        val uri = app.store.uriFor(call.getString("path") ?: "") ?: throw UserError("El archivo se movió o se borró.")
        if (!Gallery.exists(context, uri)) throw UserError("El archivo se movió o se borró.")
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, Gallery.mimeType(context, uri) ?: "video/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val chooser = Intent.createChooser(view, "Abrir con").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (activity ?: context).startActivity(chooser)
        null
    }

    @PluginMethod
    fun readClipboardUrl(call: PluginCall) {
        // Android solo deja leer el portapapeles desde el hilo principal con la app a la vista.
        val activity = activity ?: return call.resolve(JSObject())
        activity.runOnUiThread {
            val text = try {
                val cm = activity.getSystemService(ClipboardManager::class.java)
                cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(activity)?.toString()?.trim()
            } catch (_: Exception) {
                null
            }
            val url = text?.takeIf { Regex("""^https?://\S+$""", RegexOption.IGNORE_CASE).matches(it) }
            call.resolve(JSObject().apply { if (url != null) put("url", url) })
        }
    }

    /** Links compartidos desde otras apps que llegaron antes de que la interfaz se suscribiera; los siguientes van como evento. */
    @PluginMethod
    fun takePendingCommands(call: PluginCall) = sync(call) {
        val pending = CommandBus.attach { type, url -> notifyListeners("command", JSObject().put("type", type).put("url", url)) }
        JSObject().put("commands", JSArray(pending.map { (type, url) -> JSONObject().put("type", type).put("url", url) }))
    }

    // ---------- Motor ----------

    @PluginMethod
    fun engineInfo(call: PluginCall) = async(call) {
        JSObject().put("version", Engine.version(context)).put("updating", app.engineUpdating)
    }

    @PluginMethod
    fun updateEngine(call: PluginCall) = async(call) { js(app.runEngineUpdate()) }

    @PluginMethod
    fun appVersion(call: PluginCall) = sync(call) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        JSObject().put("version", info.versionName ?: "")
    }

    // ---------- Sesiones (solo cuando un sitio las pide) ----------

    /** Se responde al cerrar la pantalla de inicio de sesión. */
    @PluginMethod
    fun login(call: PluginCall) {
        val site = Sites.forKey(call.getString("site") ?: "") ?: return call.reject("Sitio no válido")
        LoginActivity.start(activity ?: context, site) { ok -> call.resolve(JSObject().put("ok", ok)) }
    }

    @PluginMethod
    fun logout(call: PluginCall) {
        val site = Sites.forKey(call.getString("site") ?: "") ?: return call.reject("Sitio no válido")
        // CookieManager se usa desde el hilo principal.
        (activity ?: return call.reject("La app no está a la vista")).runOnUiThread {
            app.cookies.logout(site)
            call.resolve()
        }
    }

    @PluginMethod
    fun listLogins(call: PluginCall) = sync(call) { JSObject().put("sites", JSArray(app.cookies.list())) }

    companion object {
        private const val REQ_NOTIFICATIONS = 7301
    }
}
