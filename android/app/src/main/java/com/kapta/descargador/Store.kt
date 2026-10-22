// Ajustes e historial, guardados como JSON en la carpeta privada de la app. Port de src/main/store.ts.
package com.kapta.descargador

import android.content.Context
import android.net.Uri
import com.kapta.descargador.core.Parse
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class Store(private val ctx: Context) {
    private val settingsFile = File(ctx.filesDir, "settings.json")
    private val historyFile = File(ctx.filesDir, "history.json")
    private val thumbsDir = File(ctx.filesDir, "thumbs")

    private fun read(file: File): String? = try {
        file.readText()
    } catch (_: Exception) {
        null
    }

    /** Escritura atómica: primero a .tmp y luego renombrar, para no corromper el archivo si la app se cierra. */
    private fun write(file: File, text: String) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(text)
        tmp.renameTo(file)
    }

    // ---------- Ajustes ----------

    private fun defaults(): JSONObject = JSONObject()
        // Solo informativo: en Android la carpeta es fija (Películas o Música → Kapta Descargador).
        .put("outputDir", "Galería → ${Gallery.FOLDER}")
        .put("defaultMode", "video")
        .put("defaultQuality", 1080)
        .put("audioFormat", "mp3")
        .put("editorCompatible", true)
        .put("cookiesBrowser", "none")
        .put("autoUpdateEngine", true)
        .put("lastEngineCheck", 0)
        .put("onboardingDone", false)
        .put("menuBar", false)
        .put("loginItem", "")

    private var settings: JSONObject? = null

    @Synchronized
    fun settings(): JSONObject {
        settings?.let { return JSONObject(it.toString()) }
        val s = defaults()
        read(settingsFile)?.let { text ->
            runCatching { JSONObject(text) }.getOrNull()?.let { saved ->
                for (k in saved.keys()) if (s.has(k) && k != "outputDir") s.put(k, saved.get(k))
            }
        }
        settings = s
        return JSONObject(s.toString())
    }

    /** Aplica solo los campos válidos; la interfaz no es de confianza total. */
    @Synchronized
    fun updateSettings(patch: JSONObject): JSONObject {
        val s = settings()
        when (val v = patch.opt("defaultMode")) { "video", "audio" -> s.put("defaultMode", v) }
        (patch.opt("defaultQuality") as? Number)?.toInt()?.let { if (it == 0 || it in Parse.QUALITY_STEPS) s.put("defaultQuality", it) }
        when (val v = patch.opt("audioFormat")) { "mp3", "m4a", "wav" -> s.put("audioFormat", v) }
        (patch.opt("editorCompatible") as? Boolean)?.let { s.put("editorCompatible", it) }
        (patch.opt("autoUpdateEngine") as? Boolean)?.let { s.put("autoUpdateEngine", it) }
        (patch.opt("lastEngineCheck") as? Number)?.toLong()?.let { s.put("lastEngineCheck", it) }
        (patch.opt("onboardingDone") as? Boolean)?.let { s.put("onboardingDone", it) }
        settings = s
        write(settingsFile, s.toString(2))
        return JSONObject(s.toString())
    }

    // ---------- Historial ----------

    private var history: MutableList<JSONObject>? = null

    private fun load(): MutableList<JSONObject> {
        history?.let { return it }
        val list = mutableListOf<JSONObject>()
        read(historyFile)?.let { text ->
            runCatching { JSONArray(text) }.getOrNull()?.let { arr -> for (i in 0 until arr.length()) arr.optJSONObject(i)?.let(list::add) }
        }
        history = list
        return list
    }

    private fun save() = write(historyFile, JSONArray(load()).toString(2))

    private fun thumbFile(id: String) = File(thumbsDir, "$id.jpg")

    /** Guarda la miniatura como JPG pequeño. */
    private fun saveThumb(id: String, dataUrl: String?): Boolean {
        val img = Engine.decodeDataUrl(dataUrl) ?: return false
        thumbsDir.mkdirs()
        val jpeg = Engine.toJpegDataUrl(img, 320, 82).substringAfter(',')
        thumbFile(id).writeBytes(android.util.Base64.decode(jpeg, android.util.Base64.DEFAULT))
        return true
    }

    @Synchronized
    fun addHistory(id: String, title: String, platform: String, mode: String, saved: Gallery.Saved, thumbDataUrl: String?) {
        val list = load()
        // Si se volvió a bajar al mismo archivo, la entrada vieja apunta a lo mismo: se reemplaza.
        list.filter { it.optString("filePath") == saved.path }.forEach {
            thumbFile(it.optString("id")).delete()
            list.remove(it)
        }
        val hasThumb = saveThumb(id, thumbDataUrl)
        list.add(
            0,
            JSONObject()
                .put("id", id)
                .put("title", title)
                .put("platform", platform)
                .put("mode", mode)
                .put("filePath", saved.path)
                .put("uri", saved.uri.toString())
                .putOpt("thumbnail", if (hasThumb) "$id.jpg" else null)
                .put("size", saved.size)
                .put("createdAt", System.currentTimeMillis())
        )
        while (list.size > MAX_HISTORY) thumbFile(list.removeAt(list.size - 1).optString("id")).delete()
        save()
    }

    @Synchronized
    fun listHistory(): JSONArray {
        val out = JSONArray()
        for (h in load()) {
            val item = JSONObject(h.toString())
            item.remove("uri")
            item.remove("thumbnail")
            if (h.has("thumbnail")) {
                runCatching { thumbFile(h.optString("id")).readBytes() }.getOrNull()?.let {
                    item.put("thumbnail", "data:image/jpeg;base64," + android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP))
                }
            }
            item.put("exists", uriOf(h)?.let { Gallery.exists(ctx, it) } ?: false)
            out.put(item)
        }
        return out
    }

    @Synchronized
    fun removeHistory(id: String) {
        val list = load()
        if (list.removeAll { it.optString("id") == id }) {
            thumbFile(id).delete()
            save()
        }
    }

    private fun uriOf(h: JSONObject): Uri? = h.optString("uri").takeIf { it.startsWith("content://") }?.let(Uri::parse)

    /** El archivo de la galería que corresponde a una ruta de la Biblioteca o de la lista de descargas. */
    @Synchronized
    fun uriFor(filePath: String): Uri? = load().firstOrNull { it.optString("filePath") == filePath }?.let(::uriOf)

    companion object {
        private const val MAX_HISTORY = 500
    }
}
