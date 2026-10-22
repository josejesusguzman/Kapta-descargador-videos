// Mismos casos que los de argumentos en src/main/parse.test.ts, para el port de Android.
package com.kapta.descargador.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArgsTest {
    private val base = DownloadRequest(
        url = "https://www.youtube.com/watch?v=x", title = "t", platform = "Youtube", thumbnail = null,
        mode = "video", quality = 1080, audioFormat = "mp3", editorCompatible = true
    )

    @Test fun videoConCalidadMaximaYPreferenciaH264() {
        assertEquals(
            listOf("-f", "bv*+ba/b", "-S", "res:1080,hdr:SDR,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"),
            Args.formatArgs(base)
        )
    }

    @Test fun videoMejorDisponibleSinModoCompatible() {
        assertTrue(Args.formatArgs(base.copy(quality = 0, editorCompatible = false)).contains("res,acodec:aac"))
    }

    @Test fun audioEnCadaFormato() {
        assertEquals(listOf("-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"), Args.formatArgs(base.copy(mode = "audio")))
        assertTrue(Args.formatArgs(base.copy(mode = "audio", audioFormat = "wav")).contains("wav"))
        assertTrue(Args.formatArgs(base.copy(mode = "audio", audioFormat = "m4a")).contains("acodec:aac"))
    }

    @Test fun elNombreDistingueLaCalidadEnVideo() {
        assertEquals("%(title).150B [%(id)s] 4K.%(ext)s", Args.outputTemplate("video", 2160))
        assertEquals("%(title).150B [%(id)s] 1080p.%(ext)s", Args.outputTemplate("video", 1080))
        assertEquals("%(title).150B [%(id)s].%(ext)s", Args.outputTemplate("video", 0))
        assertEquals("%(title).150B [%(id)s].%(ext)s", Args.outputTemplate("audio", 1080))
    }

    @Test fun laUrlVaAlFinalYLasCookiesSoloSiHaySesion() {
        val args = Args.downloadArgs(base.copy(url = "-malicioso"), "/data/out", "/data/tmp/job1", null, "@@Fk:")
        assertEquals(listOf("--", "-malicioso"), args.takeLast(2))
        assertFalse(args.contains("--cookies"))
        assertTrue(args.joinToString(" ").contains("-P /data/out -P temp:/data/tmp/job1"))
        assertTrue(args.contains("after_move:@@Fk:%(filepath)s"))
        val withCookies = Args.downloadArgs(base, "/data/out", "/data/tmp", "/data/cookies/youtube.txt", "@@Fk:")
        assertTrue(withCookies.joinToString(" ").contains("--cookies /data/cookies/youtube.txt"))
        assertEquals(listOf("--", base.url), Args.analyzeArgs(base.url, null).takeLast(2))
    }

    @Test fun aceptaSoloVideoYAudio() {
        assertTrue(Args.isMediaFile("/x/clip [abc] 1080p.mp4"))
        assertTrue(Args.isMediaFile("/x/tema.M4A"))
        assertFalse(Args.isMediaFile("/x/setup.apk"))
        assertFalse(Args.isMediaFile("/x/video.mp4.sh"))
        assertFalse(Args.isMediaFile("/x.mp4/archivo"))
    }

    @Test fun soloRutasDentroDeLaCarpeta() {
        val dir = "/data/user/0/com.kapta.descargador/files/downloads/job1"
        assertTrue(Args.isInsideDir("$dir/clip.mp4", dir))
        assertTrue(Args.isInsideDir("$dir/sub/clip.mp4", "$dir/"))
        assertFalse(Args.isInsideDir("$dir/../otro.mp4", dir))
        assertFalse(Args.isInsideDir("${dir}2/clip.mp4", dir))
        assertFalse(Args.isInsideDir(dir, dir))
    }
}
