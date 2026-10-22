// Construcción de argumentos de yt-dlp. Port de src/main/ytdlpArgs.ts; sin Android para poder probarlo en la JVM.
// youtubedl-android agrega por su cuenta --js-runtimes (QuickJS incluido), --ffmpeg-location y --no-cache-dir.
package com.kapta.descargador.core

import java.io.File

/** Marcadores que la app busca en la salida de yt-dlp. */
object Mark {
    const val PROGRESS = "@@P"
    const val POSTPROCESS = "@@S"
    const val FILE = "@@F"
    const val FORMATS = "@@N"
}

object Args {
    /** Extensiones de video y audio aceptadas. Un link directo a otro tipo de archivo se rechaza. */
    private val MEDIA_EXTENSIONS = setOf(
        "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "3gp", "ts",
        "mp3", "m4a", "aac", "wav", "opus", "ogg", "oga", "flac", "weba"
    )

    fun isMediaFile(filePath: String): Boolean {
        val m = Regex("""\.([^.\\/]+)$""").find(filePath) ?: return false
        return m.groupValues[1].lowercase() in MEDIA_EXTENSIONS
    }

    /** `filePath` está dentro de `dir` (o en una subcarpeta), después de resolver `..`. */
    fun isInsideDir(filePath: String, dir: String): Boolean {
        val f = File(filePath).normalize().absoluteFile.normalize()
        val d = File(dir).normalize().absoluteFile.normalize()
        return f != d && f.path.startsWith(d.path + File.separator)
    }

    /** `cookiesFile`: archivo Netscape del sitio, solo si el usuario inició sesión en él. */
    fun commonArgs(cookiesFile: String?): List<String> {
        val args = mutableListOf("--encoding", "utf-8", "--no-playlist", "--no-warnings")
        if (cookiesFile != null) args += listOf("--cookies", cookiesFile)
        return args
    }

    fun analyzeArgs(url: String, cookiesFile: String?): List<String> =
        listOf("-J", "--flat-playlist") + commonArgs(cookiesFile) + listOf("--", url)

    /** Selección de formato según modo y calidad. */
    fun formatArgs(req: DownloadRequest): List<String> {
        if (req.mode == "audio") {
            val args = mutableListOf("-f", "ba/b", "-x", "--audio-format", req.audioFormat, "--audio-quality", "0")
            // Para M4A, preferir AAC de origen y así evitar recodificar.
            if (req.audioFormat == "m4a") args += listOf("-S", "acodec:aac")
            return args
        }
        // "res" en -S usa el lado corto del video, así que también funciona con videos verticales (TikTok, Shorts).
        val sort = mutableListOf(if (req.quality > 0) "res:${req.quality}" else "res")
        if (req.editorCompatible) sort += listOf("hdr:SDR", "vcodec:h264")
        sort += "acodec:aac"
        return listOf("-f", "bv*+ba/b", "-S", sort.joinToString(","), "--merge-output-format", "mp4")
    }

    /** Nombre del archivo. En video incluye la calidad pedida, para no confundirlo con otra calidad ya bajada. */
    fun outputTemplate(mode: String, quality: Int): String {
        val base = "%(title).150B [%(id)s]"
        if (mode == "audio" || quality == 0) return "$base.%(ext)s"
        return "$base ${if (quality >= 2160) "4K" else "${quality}p"}.%(ext)s"
    }

    /**
     * `fileMark` es el marcador de la ruta final con un sufijo aleatorio por descarga: en Android stdout y stderr llegan
     * mezclados, y así un texto del sitio en stderr no puede hacerse pasar por la ruta final.
     */
    fun downloadArgs(req: DownloadRequest, outputDir: String, tempDir: String, cookiesFile: String?, fileMark: String): List<String> =
        commonArgs(cookiesFile) + listOf(
            "--quiet",
            "--progress",
            "--newline",
            "--progress-template", "download:${Mark.PROGRESS}%(progress)j",
            "--progress-template", "postprocess:${Mark.POSTPROCESS}%(progress)j",
            "--print", "before_dl:${Mark.FORMATS}%(format_id)s",
            "--print", "after_move:$fileMark%(filepath)s"
        ) + formatArgs(req) + listOf(
            "-P", outputDir,
            "-P", "temp:$tempDir",
            "-o", outputTemplate(req.mode, req.quality),
            "--windows-filenames",
            "--no-mtime",
            "--",
            req.url
        )
}
