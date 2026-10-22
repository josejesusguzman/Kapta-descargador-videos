// Recodificación "compatible con editores": convierte VP9/AV1 a H.264 para que CapCut lo importe sin problemas.
// Port de src/main/ffmpeg.ts con el FFmpeg que trae youtubedl-android (incluye MediaCodec y libx264).
package com.kapta.descargador

import android.content.Context
import com.kapta.descargador.core.UserError
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object Ffmpeg {
    data class ProbeResult(val vcodec: String? = null, val width: Int? = null, val height: Int? = null, val duration: Double? = null)

    private class Encoder(val name: String, val args: (Int) -> List<String>)

    /** Bitrate generoso para edición, según la resolución. */
    private fun bitrate(h: Int) = if (h >= 2000) "45M" else if (h >= 1400) "24M" else if (h >= 1000) "12M" else if (h >= 700) "7M" else "4M"

    // En orden de preferencia: el encoder por hardware del teléfono (MediaCodec) y, si falla, la CPU.
    private val ENCODERS = listOf(
        Encoder("h264_mediacodec") { h -> listOf("-c:v", "h264_mediacodec", "-b:v", bitrate(h), "-pix_fmt", "nv12") },
        Encoder("libx264") { _ -> listOf("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p") }
    )
    private val CPU = ENCODERS.last()

    private fun binDir(ctx: Context) = File(ctx.applicationInfo.nativeLibraryDir)

    /** Mismo entorno con el que youtubedl-android ejecuta FFmpeg (sus bibliotecas se descomprimen en noBackupFilesDir). */
    private fun process(ctx: Context, exe: String, args: List<String>): ProcessBuilder {
        val packages = File(ctx.noBackupFilesDir, "youtubedl-android/packages")
        return ProcessBuilder(listOf(File(binDir(ctx), exe).absolutePath) + args).apply {
            environment()["LD_LIBRARY_PATH"] = "${packages}/python/usr/lib:${packages}/ffmpeg/usr/lib"
            environment()["TMPDIR"] = ctx.cacheDir.absolutePath
        }
    }

    fun probe(ctx: Context, file: File): ProbeResult = try {
        val p = process(
            ctx, "libffprobe.so",
            listOf("-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file.absolutePath)
        ).redirectErrorStream(false).start()
        p.errorStream.close()
        val out = p.inputStream.bufferedReader().readText()
        if (!p.waitFor(30, TimeUnit.SECONDS) || p.exitValue() != 0) {
            p.destroy()
            ProbeResult()
        } else {
            val j = JSONObject(out)
            val s = j.optJSONArray("streams")?.optJSONObject(0) ?: JSONObject()
            ProbeResult(
                vcodec = s.optString("codec_name").ifEmpty { null },
                width = s.optInt("width").takeIf { it > 0 },
                height = s.optInt("height").takeIf { it > 0 },
                duration = j.optJSONObject("format")?.optString("duration")?.toDoubleOrNull()
            )
        }
    } catch (_: Exception) {
        ProbeResult()
    }

    /** H.264 y HEVC son los que CapCut y la mayoría de editores importan sin problemas. */
    fun needsRecode(vcodec: String?): Boolean = vcodec != null && vcodec !in listOf("h264", "hevc")

    private fun tryEncoder(ctx: Context, enc: Encoder): Boolean = try {
        val p = process(
            ctx, "libffmpeg.so",
            listOf("-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=0.3", "-frames:v", "5") +
                enc.args(720) + listOf("-f", "null", "-")
        ).redirectErrorStream(true).start()
        p.inputStream.use { it.readBytes() }
        if (!p.waitFor(15, TimeUnit.SECONDS)) {
            p.destroy()
            false
        } else p.exitValue() == 0
    } catch (_: Exception) {
        false
    }

    @Volatile private var encoder: Encoder? = null

    /** Detecta (una sola vez) el mejor encoder H.264 que funciona en este teléfono. */
    @Synchronized
    private fun detectEncoder(ctx: Context): Encoder =
        encoder ?: (ENCODERS.firstOrNull { tryEncoder(ctx, it) } ?: CPU).also { encoder = it }

    private fun encode(
        ctx: Context,
        enc: Encoder,
        input: File,
        output: File,
        info: ProbeResult,
        onProgress: (Double) -> Unit,
        isCanceled: () -> Boolean,
        onProcess: (Process?) -> Unit
    ): Boolean {
        val args = listOf("-hide_banner", "-loglevel", "error", "-y", "-i", input.absolutePath, "-map", "0:v:0", "-map", "0:a:0?") +
            enc.args(info.height ?: 1080) +
            listOf("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output.absolutePath)
        val p = try {
            process(ctx, "libffmpeg.so", args).redirectErrorStream(false).start()
        } catch (_: Exception) {
            return false
        }
        onProcess(p)
        try {
            // stderr se descarta en otro hilo para que FFmpeg no se bloquee si escribe mucho.
            Thread { runCatching { p.errorStream.use { it.readBytes() } } }.start()
            val re = Regex("""^out_time_(?:us|ms)=(\d+)""")
            p.inputStream.bufferedReader().useLines { lines ->
                for (l in lines) {
                    val m = re.find(l) ?: continue
                    val d = info.duration ?: continue
                    onProgress(minOf(99.0, m.groupValues[1].toDouble() / 1e6 / d * 100))
                }
            }
            p.waitFor()
            return !isCanceled() && p.exitValue() == 0
        } catch (_: Exception) {
            return false
        } finally {
            onProcess(null)
            p.destroy()
        }
    }

    /** Recodifica `file` a H.264 en el mismo lugar. Si el encoder por hardware falla, reintenta con CPU. */
    fun recodeForEditing(
        ctx: Context,
        file: File,
        info: ProbeResult,
        onProgress: (Double) -> Unit,
        isCanceled: () -> Boolean,
        onProcess: (Process?) -> Unit
    ) {
        val tmp = File(file.parentFile, file.name.replace(Regex("""\.(\w+)$"""), ".editando.$1"))
        val enc = detectEncoder(ctx)
        var ok = encode(ctx, enc, file, tmp, info, onProgress, isCanceled, onProcess)
        if (!ok && !isCanceled() && enc !== CPU) {
            onProgress(0.0)
            ok = encode(ctx, CPU, file, tmp, info, onProgress, isCanceled, onProcess)
        }
        if (!ok) {
            tmp.delete()
            if (isCanceled()) throw CanceledError()
            throw UserError("No se pudo optimizar el video para edición. Desactiva \"Compatible con editores\" e inténtalo de nuevo.")
        }
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw UserError("No se pudo optimizar el video para edición. Desactiva \"Compatible con editores\" e inténtalo de nuevo.")
        }
    }
}
