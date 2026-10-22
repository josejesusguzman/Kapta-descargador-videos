// yt-dlp vía youtubedl-android (Python, yt-dlp, QuickJS y FFmpeg para Android): análisis de links, descargas y
// actualización del motor. Port de src/main/ytdlp.ts.
package com.kapta.descargador

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.kapta.descargador.core.Args
import com.kapta.descargador.core.DownloadRequest
import com.kapta.descargador.core.ParsedLine
import com.kapta.descargador.core.Parse
import com.kapta.descargador.core.Site
import com.kapta.descargador.core.Sites
import com.kapta.descargador.core.UserError
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch

/** La descarga se canceló (no es un error que mostrar). */
class CanceledError : Exception("Cancelado")

object Engine {
    private val ready = CountDownLatch(1)
    @Volatile private var initError: Throwable? = null
    @Volatile private var cachedVersion: String? = null

    /** Descomprime Python y FFmpeg la primera vez (tarda unos segundos): se llama en un hilo aparte al abrir la app. */
    fun init(ctx: Context) {
        try {
            YoutubeDL.init(ctx)
            FFmpeg.init(ctx)
        } catch (e: Throwable) {
            initError = e
        } finally {
            ready.countDown()
        }
    }

    private fun awaitReady() {
        ready.await()
        initError?.let { throw UserError("No se pudo preparar el motor de descarga: ${it.message}") }
    }

    /** Petición con nuestros argumentos tal cual; la caché de yt-dlp (reproductor de YouTube) acelera los análisis. */
    private fun request(ctx: Context, args: List<String>): YoutubeDLRequest =
        YoutubeDLRequest(emptyList<String>())
            .addOption("--cache-dir", File(ctx.cacheDir, "yt-dlp").absolutePath)
            .addCommands(args)

    private fun friendly(output: String, site: Site?): UserError {
        val f = Parse.friendlyError(output)
        return UserError(f.message, if (f.needsLogin) site?.key else null)
    }

    fun analyze(ctx: Context, url: String, cookies: Cookies): JSONObject {
        val clean = url.trim()
        if (!Regex("""^https?://\S+$""", RegexOption.IGNORE_CASE).matches(clean)) {
            throw UserError("Pega un link válido que empiece con http:// o https://")
        }
        awaitReady()
        val site = Sites.forUrl(clean)
        val out = try {
            YoutubeDL.execute(request(ctx, Args.analyzeArgs(clean, cookies.fileFor(site))), null, null).out
        } catch (e: YoutubeDLException) {
            throw friendly(e.message ?: "", site)
        } catch (e: YoutubeDL.CanceledException) {
            throw UserError("Cancelado")
        }

        val info = try {
            JSONObject(out)
        } catch (_: Exception) {
            throw UserError("El motor de descarga devolvió una respuesta inesperada.")
        }
        if (info.optString("_type") == "playlist") {
            throw UserError("Ese link es una lista o un perfil. Pega el link de un video en particular.")
        }

        fun text(vararg keys: String): String? = keys.firstNotNullOfOrNull { k -> (info.opt(k) as? String)?.takeIf { it.isNotEmpty() } }
        return JSONObject()
            .put("url", text("webpage_url") ?: clean)
            .put("id", info.opt("id")?.toString() ?: "")
            .put("title", text("title", "fulltitle") ?: "Sin título")
            .put("platform", text("extractor_key", "extractor") ?: "Web")
            .putOpt("uploader", text("uploader", "channel", "creator"))
            .putOpt("duration", (info.opt("duration") as? Number)?.toDouble())
            .putOpt("thumbnail", fetchThumbnail(Parse.pickThumbnail(info.optJSONArray("thumbnails"), text("thumbnail"))))
            .put("qualities", JSONArray(Parse.availableQualities(info.optJSONArray("formats"))))
    }

    /** Descarga la miniatura y la devuelve como JPG pequeño en data URL (Android también lee WebP). */
    private fun fetchThumbnail(url: String?): String? {
        if (url == null || !Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return null
        return try {
            val conn = URI(url).toURL().openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            try {
                if (conn.responseCode !in 200..299) return null
                val bytes = conn.inputStream.use { input ->
                    val buf = ByteArrayOutputStream()
                    val chunk = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        buf.write(chunk, 0, n)
                        if (buf.size() > 4 * 1024 * 1024) return null
                    }
                    buf.toByteArray()
                }
                val img = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
                toJpegDataUrl(img, 640, 85)
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    fun toJpegDataUrl(img: Bitmap, maxWidth: Int, quality: Int): String {
        val scaled = if (img.width > maxWidth) Bitmap.createScaledBitmap(img, maxWidth, img.height * maxWidth / img.width, true) else img
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    interface DownloadCallbacks {
        fun onProgress(percent: Double, stage: String, speed: Double?, eta: Double?)
        fun onStage(stage: String)
    }

    /** Carpeta privada donde yt-dlp deja cada descarga antes de copiarla a la galería. */
    fun stagingDir(ctx: Context, jobId: String) = File(ctx.filesDir, "downloads/$jobId")
    private fun tempDir(ctx: Context, jobId: String) = File(ctx.cacheDir, "jobs/$jobId")

    /** Al abrir la app no hay descargas activas: lo que quede es de una sesión interrumpida. */
    fun cleanLeftovers(ctx: Context) {
        File(ctx.filesDir, "downloads").deleteRecursively()
        File(ctx.cacheDir, "jobs").deleteRecursively()
    }

    fun cancel(jobId: String) {
        YoutubeDL.destroyProcessById(jobId)
    }

    /** Devuelve el archivo descargado, dentro de la carpeta privada de la descarga. */
    fun download(
        ctx: Context,
        jobId: String,
        req: DownloadRequest,
        cookies: Cookies,
        cb: DownloadCallbacks,
        isCanceled: () -> Boolean
    ): File {
        awaitReady()
        val outputDir = stagingDir(ctx, jobId).apply { deleteRecursively(); mkdirs() }
        val tempDir = tempDir(ctx, jobId).apply { mkdirs() }
        val site = Sites.forUrl(req.url)
        val fileMark = "@@F" + ByteArray(6).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) } + ":"

        var parts = 1
        var partIndex = -1
        var currentFile = ""
        var finalPath = ""
        val tail = StringBuilder()

        fun partLabel(): String = when {
            req.mode == "audio" -> "Descargando audio"
            parts > 1 -> if (partIndex == 0) "Descargando video" else "Descargando audio"
            else -> "Descargando"
        }
        // El video pesa mucho más que el audio: se reparte la barra 85 / 15.
        fun overall(p: Double): Double = if (parts < 2) p else if (partIndex == 0) p * 0.85 else 85 + p * 0.15

        fun handle(parsed: ParsedLine) {
            when (parsed) {
                is ParsedLine.Formats -> parts = parsed.formatId.split('+').size
                is ParsedLine.Progress -> {
                    val name = parsed.data.filename
                    if (name != null && name != currentFile) {
                        currentFile = name
                        partIndex = minOf(partIndex + 1, parts - 1)
                    }
                    cb.onProgress(overall(parsed.data.percent), partLabel(), parsed.data.speed, parsed.data.eta)
                }
                is ParsedLine.Postprocess ->
                    if (parsed.status == "started" && parsed.postprocessor != "MoveFiles") cb.onStage(Parse.postprocessLabel(parsed.postprocessor))
                is ParsedLine.FilePath -> finalPath = parsed.path.trim()
            }
        }

        try {
            if (isCanceled()) throw CanceledError()
            val args = Args.downloadArgs(req, outputDir.absolutePath, tempDir.absolutePath, cookies.fileFor(site), fileMark)
            try {
                // stderr junto con stdout: así llegan también las etapas de post-proceso y los errores.
                YoutubeDL.execute(request(ctx, args), jobId, true) { _, _, line ->
                    if (line.isEmpty()) return@execute
                    tail.append(line).append('\n')
                    if (tail.length > 20000) tail.delete(0, tail.length - 20000)
                    Parse.parseLine(line, fileMark)?.let(::handle)
                }
            } catch (e: YoutubeDL.CanceledException) {
                throw CanceledError()
            } catch (e: YoutubeDLException) {
                if (isCanceled()) throw CanceledError()
                throw friendly(tail.toString().ifEmpty { e.message ?: "" }, site)
            } catch (e: InterruptedException) {
                throw CanceledError()
            }
            if (isCanceled()) throw CanceledError()

            // Nunca se usa (ni se borra) una ruta fuera de la carpeta de la descarga.
            if (finalPath.isNotEmpty() && !Args.isInsideDir(finalPath, outputDir.absolutePath)) {
                throw UserError("La descarga terminó fuera de la carpeta elegida.")
            }
            val file = File(finalPath)
            if (finalPath.isEmpty() || !file.exists()) throw UserError("La descarga terminó pero no se encontró el archivo.")
            if (!Args.isMediaFile(finalPath)) {
                file.delete()
                throw UserError("Ese link no es un video ni un audio.")
            }
            return file
        } finally {
            // Pistas sueltas, .part y fragmentos: se van todos con la carpeta temporal de la descarga.
            tempDir.deleteRecursively()
        }
    }

    /** Versión de yt-dlp: la que guarda el actualizador o, si nunca se actualizó, la que reporta el motor. */
    fun version(ctx: Context): String {
        YoutubeDL.versionName(ctx)?.takeIf { it.isNotBlank() }?.let { return it }
        cachedVersion?.let { return it }
        return try {
            awaitReady()
            val v = YoutubeDL.execute(request(ctx, listOf("--version")), null, null).out.trim()
            v.ifEmpty { "?" }.also { cachedVersion = it }
        } catch (_: Exception) {
            "?"
        }
    }

    /** Actualiza yt-dlp desde sus releases de GitHub (lo hace youtubedl-android). */
    fun update(ctx: Context): JSONObject {
        awaitReady()
        return try {
            val status = YoutubeDL.updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
            cachedVersion = null
            val v = version(ctx)
            if (status == YoutubeDL.UpdateStatus.ALREADY_UP_TO_DATE) {
                JSONObject().put("ok", true).put("message", "El motor ya está en la última versión.").put("version", v)
            } else {
                JSONObject().put("ok", true).put("message", "Motor actualizado a la versión $v.").put("version", v)
            }
        } catch (_: Exception) {
            JSONObject().put("ok", false).put("message", "No se pudo actualizar el motor. Revisa tu conexión e inténtalo de nuevo.")
        }
    }

    /** data URL de imagen → Bitmap (miniaturas que manda la interfaz). */
    fun decodeDataUrl(dataUrl: String?): Bitmap? {
        if (dataUrl == null || !dataUrl.startsWith("data:image/")) return null
        return try {
            val bytes = Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        }
    }
}
