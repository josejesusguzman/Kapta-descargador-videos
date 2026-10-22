package com.kapta.descargador.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SitesTest {
    @Test fun reconoceLosSitiosPrincipales() {
        assertEquals("youtube", Sites.forUrl("https://youtu.be/abc")?.key)
        assertEquals("youtube", Sites.forUrl("https://m.youtube.com/watch?v=x")?.key)
        assertEquals("instagram", Sites.forUrl("https://www.instagram.com/reel/x/")?.key)
        assertEquals("twitter", Sites.forUrl("https://x.com/a/status/1")?.key)
        assertEquals("tiktok", Sites.forUrl("https://vm.tiktok.com/abc")?.key)
    }

    @Test fun otrosSitiosUsanSuDominioPrincipal() {
        val s = Sites.forUrl("https://player.ejemplo.mx/v/1")
        assertEquals("ejemplo.mx", s?.key)
        assertEquals(s, Sites.forKey("ejemplo.mx"))
        assertNull(Sites.forUrl("no es un link"))
    }

    @Test fun lasClavesNoPuedenSalirseDeLaCarpeta() {
        assertNull(Sites.forKey("../settings"))
        assertNull(Sites.forKey(".."))
        assertNull(Sites.forKey("a/b"))
        assertEquals("youtube", Sites.forKey("youtube")?.key)
    }

    @Test fun cookiesEnFormatoNetscape() {
        val lines = CookieFile.lines("SID=abc; HSID=d=e; roto", "www.youtube.com", 2000000000)
        assertEquals(listOf(".youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tabc", ".youtube.com\tTRUE\t/\tTRUE\t2000000000\tHSID\td=e"), lines)
        val file = CookieFile.build(lines + lines)
        assertTrue(file.startsWith(CookieFile.HEADER))
        assertEquals(2, file.lines().count { it.startsWith(".youtube.com") })
        assertTrue(CookieFile.looksValid(file))
    }
}
