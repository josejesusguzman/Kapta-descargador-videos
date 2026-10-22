// Mismos casos que src/main/parse.test.ts, para el port de Android.
package com.kapta.descargador.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParseTest {
    private fun progress(line: String): ProgressData = (Parse.parseLine(line) as ParsedLine.Progress).data

    @Test fun leeProgresoConPercent() {
        val p = progress(
            """@@P{"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 433081, "tmpfilename": "/x/a.f133.mp4.part", "filename": "/x/a.f133.mp4", "eta": 3, "speed": 108838.05, "_percent": 0.2364}"""
        )
        assertEquals(0.2364, p.percent, 1e-9)
        assertEquals(108838.05, p.speed!!, 1e-9)
        assertEquals(3.0, p.eta!!, 0.0)
        assertEquals("/x/a.f133.mp4", p.filename)
        assertEquals("/x/a.f133.mp4.part", p.tmpfilename)
    }

    @Test fun calculaPorcentajeConBytesEstimadosOFragmentos() {
        assertEquals(25.0, progress("""@@P{"status":"downloading","downloaded_bytes":50,"total_bytes_estimate":200}""").percent, 0.0)
        assertEquals(25.0, progress("""@@P{"status":"downloading","fragment_index":3,"fragment_count":12}""").percent, 0.0)
    }

    @Test fun marca100AlTerminarYAcotaValoresRaros() {
        assertEquals(100.0, progress("""@@P{"status":"finished","downloaded_bytes":10}""").percent, 0.0)
        val over = progress("""@@P{"status":"downloading","_percent":180,"speed":null}""")
        assertEquals(100.0, over.percent, 0.0)
        assertNull(over.speed)
    }

    @Test fun leePostprocesadoArchivoFinalYFormatos() {
        assertEquals(ParsedLine.Postprocess("started", "Merger"), Parse.parseLine("""@@S{"status": "started", "postprocessor": "Merger"}"""))
        assertEquals(ParsedLine.FilePath("/storage/Clip ñandú [abc].mp4"), Parse.parseLine("@@F/storage/Clip ñandú [abc].mp4\r"))
        assertEquals(ParsedLine.Formats("299+140"), Parse.parseLine("@@N299+140"))
    }

    @Test fun laRutaFinalSoloValeConElMarcadorDeLaDescarga() {
        assertNull(Parse.parseLine("@@F/sdcard/otro.mp4", "@@Fabc123:"))
        assertEquals(ParsedLine.FilePath("/data/x.mp4"), Parse.parseLine("@@Fabc123:/data/x.mp4", "@@Fabc123:"))
    }

    @Test fun ignoraLineasBasuraYJsonRoto() {
        assertNull(Parse.parseLine("[download] Destination: x.mp4"))
        assertNull(Parse.parseLine(""))
        assertNull(Parse.parseLine("""@@P{"status": "downl"""))
    }

    @Test fun calidadUsaLadoCortoOEquivalente169() {
        assertEquals(1080, Parse.formatQuality(1920, 1080))
        assertEquals(1080, Parse.formatQuality(1080, 1920))
        assertEquals(2160, Parse.formatQuality(3840, 1608))
        assertEquals(720, Parse.formatQuality(null, 720))
        assertEquals(0, Parse.formatQuality(null, null))
    }

    @Test fun agrupaFormatosEnCalidadesEstandar() {
        val formats = JSONArray(
            """[{"vcodec":"none","width":null,"height":null},{"vcodec":"avc1","width":1920,"height":1036},
               {"vcodec":"vp9","width":1920,"height":1080},{"vcodec":"vp9","width":3840,"height":2160},
               {"vcodec":"avc1","width":854,"height":480},{"vcodec":"avc1","width":256,"height":144}]"""
        )
        assertEquals(listOf(2160, 1080, 480, 360), Parse.availableQualities(formats))
        assertEquals(emptyList<Int>(), Parse.availableQualities(null))
    }

    @Test fun prefiereElJpgMasGrandeHasta1280() {
        val thumbs = JSONArray(
            """[{"url":"https://i.ytimg.com/vi/x/default.jpg","width":120},
               {"url":"https://i.ytimg.com/vi_webp/x/maxresdefault.webp","width":1920},
               {"url":"https://i.ytimg.com/vi/x/hq720.jpg?sqp=abc","width":1280},
               {"url":"https://i.ytimg.com/vi/x/maxresdefault.jpg","width":1920}]"""
        )
        assertEquals("https://i.ytimg.com/vi/x/hq720.jpg?sqp=abc", Parse.pickThumbnail(thumbs, "fallback"))
        assertEquals("https://x/b.image", Parse.pickThumbnail(JSONArray("""[{"url":"https://x/a.webp"}]"""), "https://x/b.image"))
    }

    @Test fun traduceErroresComunes() {
        fun msg(s: String) = Parse.friendlyError(s).message
        assertTrue(msg("ERROR: [youtube] abc: Private video. Sign in if you have access").contains("privado"))
        assertTrue(msg("ERROR: Unsupported URL: https://example.com").contains("no es compatible"))
        assertTrue(msg("ERROR: [youtube] x: Video unavailable").contains("no está disponible"))
        assertTrue(msg("ERROR: [generic] nada: Unable to download webpage: HTTP Error 404: Not Found").contains("No se encontró"))
        assertTrue(msg("ERROR: [youtube:tab] @Blender: This channel does not have a videos tab").contains("canal o perfil"))
    }

    @Test fun marcaLosErroresQuePidenSesion() {
        val bot = Parse.friendlyError("ERROR: [youtube] x: Sign in to confirm you're not a bot.")
        assertTrue(bot.message.contains("bot"))
        assertTrue(bot.needsLogin)
        val ig = Parse.friendlyError("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required")
        assertTrue(ig.message.contains("iniciar sesión"))
        assertTrue(ig.needsLogin)
        assertTrue(Parse.friendlyError("ERROR: [youtube] x: Sign in to confirm your age").needsLogin)
        assertFalse(Parse.friendlyError("ERROR: [youtube] x: Video unavailable").needsLogin)
    }

    @Test fun devuelveLaUltimaLineaDeErrorSiNoLaReconoce() {
        assertEquals("Something odd happened", Parse.friendlyError("WARNING: algo\nERROR: [generic] Something odd happened").message)
        assertEquals("No se pudo completar la descarga.", Parse.friendlyError("").message)
    }
}
