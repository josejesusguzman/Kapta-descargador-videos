// Interpretación de la salida de yt-dlp. Port de src/main/parse.ts; sin Android para poder probarlo en la JVM.
package com.kapta.descargador.core

import org.json.JSONArray
import org.json.JSONObject

data class ProgressData(
    val status: String,
    val percent: Double,
    val speed: Double? = null,
    val eta: Double? = null,
    val filename: String? = null,
    val tmpfilename: String? = null
)

sealed class ParsedLine {
    data class Progress(val data: ProgressData) : ParsedLine()
    data class Postprocess(val status: String, val postprocessor: String) : ParsedLine()
    data class FilePath(val path: String) : ParsedLine()
    data class Formats(val formatId: String) : ParsedLine()
}

/** Mensaje para el usuario y si el sitio pide iniciar sesión (bot, edad, contenido con sesión). */
data class Friendly(val message: String, val needsLogin: Boolean = false)

object Parse {
    val QUALITY_STEPS = listOf(2160, 1440, 1080, 720, 480, 360)

    private fun num(o: JSONObject, key: String): Double? {
        val v = o.opt(key)
        return if (v is Number && v.toDouble().isFinite()) v.toDouble() else null
    }

    private fun str(o: JSONObject, key: String): String? = o.opt(key) as? String

    fun parseLine(raw: String, fileMark: String = Mark.FILE): ParsedLine? {
        val line = raw.trim()
        try {
            if (line.startsWith(Mark.PROGRESS)) {
                val p = JSONObject(line.substring(Mark.PROGRESS.length))
                val total = num(p, "total_bytes") ?: num(p, "total_bytes_estimate")
                val done = num(p, "downloaded_bytes")
                var percent = num(p, "_percent")
                if (percent == null && total != null && total != 0.0 && done != null) percent = done / total * 100
                val fragments = num(p, "fragment_count")
                if (percent == null && fragments != null && fragments != 0.0) percent = (num(p, "fragment_index") ?: 0.0) / fragments * 100
                val status = p.opt("status")?.takeIf { it != JSONObject.NULL }?.toString() ?: "downloading"
                if (status == "finished") percent = 100.0
                return ParsedLine.Progress(
                    ProgressData(
                        status = status,
                        percent = (percent ?: 0.0).coerceIn(0.0, 100.0),
                        speed = num(p, "speed"),
                        eta = num(p, "eta"),
                        filename = str(p, "filename"),
                        tmpfilename = str(p, "tmpfilename")
                    )
                )
            }
            if (line.startsWith(Mark.POSTPROCESS)) {
                val p = JSONObject(line.substring(Mark.POSTPROCESS.length))
                return ParsedLine.Postprocess(p.optString("status", ""), p.optString("postprocessor", ""))
            }
        } catch (_: Exception) {
            return null
        }
        if (line.startsWith(fileMark)) return ParsedLine.FilePath(line.substring(fileMark.length))
        if (line.startsWith(Mark.FORMATS)) return ParsedLine.Formats(line.substring(Mark.FORMATS.length))
        return null
    }

    /** Nombre amigable de cada post-procesador de yt-dlp. */
    fun postprocessLabel(name: String): String = when (name) {
        "Merger" -> "Uniendo video y audio"
        "ExtractAudio" -> "Convirtiendo audio"
        "FixupM3u8", "FixupM4a", "FixupStretched", "FixupDuplicateMoov", "FixupTimestamp" -> "Reparando archivo"
        else -> "Procesando"
    }

    /** Calidad "p" de un formato: lado corto, o el equivalente 16:9 del lado largo si es mayor (3840×1608 → 2160). */
    fun formatQuality(width: Int?, height: Int?): Int {
        val w = width ?: 0
        val h = height ?: 0
        if (w == 0 && h == 0) return 0
        if (w == 0) return h
        if (h == 0) return Math.round(w * 9 / 16.0).toInt()
        val short = minOf(w, h)
        val long = maxOf(w, h)
        return maxOf(short, Math.round(long * 9 / 16.0).toInt())
    }

    private fun intOrNull(o: JSONObject, key: String): Int? = num(o, key)?.toInt()

    /** Calidades estándar disponibles a partir de la lista de formatos de yt-dlp, de mayor a menor. */
    fun availableQualities(formats: JSONArray?): List<Int> {
        val found = sortedSetOf<Int>(compareByDescending { it })
        if (formats == null) return emptyList()
        for (i in 0 until formats.length()) {
            val f = formats.optJSONObject(i) ?: continue
            if (f.opt("vcodec") == "none") continue
            val q = formatQuality(intOrNull(f, "width"), intOrNull(f, "height"))
            if (q == 0) continue
            found += QUALITY_STEPS.firstOrNull { q >= it * 0.95 } ?: QUALITY_STEPS.last()
        }
        return found.toList()
    }

    /** Elige una miniatura JPG de tamaño razonable (hasta 1280 px), o el respaldo. */
    fun pickThumbnail(thumbnails: JSONArray?, fallback: String?): String? {
        val jpgs = mutableListOf<JSONObject>()
        for (i in 0 until (thumbnails?.length() ?: 0)) {
            val t = thumbnails!!.optJSONObject(i) ?: continue
            val url = str(t, "url") ?: continue
            val width = num(t, "width")
            if (Regex("""\.jpe?g(\?|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url) && (width == null || width <= 1280)) jpgs += t
        }
        if (jpgs.isEmpty()) return fallback
        return jpgs.sortedWith(
            compareByDescending<JSONObject> { num(it, "width") ?: 0.0 }.thenByDescending { num(it, "preference") ?: 0.0 }
        ).first().getString("url")
    }

    private fun re(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE)

    // Mismo orden que en escritorio; los de sesión no hablan de cookies del navegador porque en Android la app
    // ofrece iniciar sesión ahí mismo.
    private val ERRORS: List<Pair<Regex, Friendly>> = listOf(
        re("""Unsupported URL|is not a valid URL|No video formats found""") to Friendly("Este link o sitio no es compatible."),
        re("""This channel|does not have a \w+ tab|is not a video""") to Friendly("Ese link es de un canal o perfil. Pega el link de un video en particular."),
        re("""HTTP Error 404|HTTP Error 410""") to Friendly("No se encontró nada en ese link. Revisa que esté completo y que el contenido sea público."),
        re("""Private video|This video is private|private account""") to Friendly("Este contenido es privado."),
        re("""not a bot|confirm you.re not a robot""") to Friendly("La plataforma pide verificar que no eres un bot. Inicia sesión para continuar o inténtalo más tarde.", true),
        re("""age.restricted|Sign in to confirm your age|inappropriate for some users""") to Friendly("Contenido con restricción de edad: hay que iniciar sesión para verlo.", true),
        re("""login required|log in|requires authentication|cookies|empty media response|rate-limit reached""") to Friendly("La plataforma pide iniciar sesión para ver este contenido.", true),
        re("""Video unavailable|has been removed|no longer available|not available in your country|geo.?restrict""") to Friendly("El video no está disponible (eliminado o bloqueado en tu región)."),
        re("""live event will begin|Premieres in|is_live|This live event""") to Friendly("Las transmisiones en vivo o estrenos no se pueden descargar hasta que terminen."),
        re("""getaddrinfo|Failed to resolve|Unable to connect|timed out|Connection reset|Network is unreachable|No connection""") to Friendly("Sin conexión a internet o la plataforma no responde."),
        re("""No space left|Errno 28""") to Friendly("No hay espacio suficiente en el teléfono."),
        re("""Permission denied|Errno 13""") to Friendly("No se pudo escribir el archivo descargado. Inténtalo de nuevo."),
        re("""Unable to extract|Signature extraction failed|nsig|n challenge|HTTP Error 403|Requested format is not available|ExtractorError""") to Friendly("La plataforma cambió algo. Actualiza el motor de descarga en Ajustes y vuelve a intentar.")
    )

    /** Convierte la salida de error de yt-dlp en un mensaje claro en español. */
    fun friendlyError(stderr: String): Friendly {
        val errorLines = stderr.split(Regex("""\r?\n""")).filter { it.startsWith("ERROR:") }.joinToString("\n")
        val text = errorLines.ifEmpty { stderr }
        for ((pattern, friendly) in ERRORS) if (pattern.containsMatchIn(text)) return friendly
        val last = errorLines.split("\n").last().replace(Regex("""^ERROR:\s*(\[[^\]]+]\s*)?"""), "").trim()
        return Friendly(last.ifEmpty { "No se pudo completar la descarga." })
    }
}
