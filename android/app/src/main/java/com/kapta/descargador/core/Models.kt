// Datos que viajan entre el plugin y la interfaz, con el mismo esquema JSON que src/shared/types.ts.
package com.kapta.descargador.core

import org.json.JSONObject

data class DownloadRequest(
    val url: String,
    val title: String,
    val platform: String,
    val thumbnail: String?,
    val mode: String,
    /** Calidad máxima en "p" (2160, 1080…). 0 = la mejor disponible. */
    val quality: Int,
    val audioFormat: String,
    val editorCompatible: Boolean
) {
    fun toJson(): JSONObject = JSONObject()
        .put("url", url)
        .put("title", title)
        .put("platform", platform)
        .putOpt("thumbnail", thumbnail)
        .put("mode", mode)
        .put("quality", quality)
        .put("audioFormat", audioFormat)
        .put("editorCompatible", editorCompatible)

    companion object {
        /** Valida lo que manda la interfaz (port de sanitizeRequest de src/main/index.ts). */
        fun sanitize(r: JSONObject?): DownloadRequest {
            val url = r?.opt("url") as? String
            if (url == null || !Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) throw UserError("Link no válido")
            val quality = (r.opt("quality") as? Number)?.toDouble()
            val audio = r.opt("audioFormat") as? String
            return DownloadRequest(
                url = url,
                title = ((r.opt("title") as? String) ?: "Sin título").take(300),
                platform = ((r.opt("platform") as? String) ?: "Web").take(60),
                thumbnail = (r.opt("thumbnail") as? String)?.takeIf { it.startsWith("data:image/") },
                mode = if (r.opt("mode") == "audio") "audio" else "video",
                quality = if (quality != null && quality % 1 == 0.0 && quality in 0.0..4320.0) quality.toInt() else 0,
                audioFormat = if (audio in listOf("mp3", "m4a", "wav")) audio!! else "mp3",
                editorCompatible = r.opt("editorCompatible") != false
            )
        }

        fun fromStored(o: JSONObject): DownloadRequest = sanitize(o)
    }
}

/** Error con un mensaje listo para mostrarse. `loginSite`: el sitio pide iniciar sesión. */
class UserError(message: String, val loginSite: String? = null) : Exception(message)

data class Job(
    val id: String,
    val request: DownloadRequest,
    var status: String = "queued",
    var percent: Double = 0.0,
    var stage: String = "En espera",
    var speed: Double? = null,
    var eta: Double? = null,
    /** Ruta pública del archivo (Películas/… o Música/…), la misma que muestra la Biblioteca. */
    var filePath: String? = null,
    var error: String? = null,
    var loginSite: String? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    val active: Boolean get() = status == "downloading" || status == "processing"

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("request", request.toJson())
        .put("status", status)
        .put("percent", percent)
        .put("stage", stage)
        .putOpt("speed", speed)
        .putOpt("eta", eta)
        .putOpt("filePath", filePath)
        .putOpt("error", error)
        .putOpt("loginSite", loginSite)
        .put("createdAt", createdAt)
}
