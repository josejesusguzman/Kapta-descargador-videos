// Sesiones guardadas: un cookies.txt por sitio, creado solo cuando el usuario inicia sesión porque un video lo pidió.
// Se pasa a yt-dlp (--cookies) únicamente para links de ese sitio.
package com.kapta.descargador

import android.content.Context
import android.webkit.CookieManager
import com.kapta.descargador.core.CookieFile
import com.kapta.descargador.core.Site
import com.kapta.descargador.core.Sites
import java.io.File
import java.net.URI

class Cookies(ctx: Context) {
    private val dir = File(ctx.filesDir, "cookies")

    private fun file(key: String) = File(dir, "$key.txt")

    /** Archivo de cookies del sitio, o null si no hay sesión guardada. */
    fun fileFor(site: Site?): String? = site?.let { file(it.key) }?.takeIf { it.isFile }?.absolutePath

    fun list(): List<String> =
        dir.listFiles { f -> f.isFile && f.name.endsWith(".txt") }?.map { it.name.removeSuffix(".txt") }?.filter { Sites.forKey(it) != null }?.sorted()
            ?: emptyList()

    /** Guarda las cookies que dejó el inicio de sesión en el WebView. false si no hay ninguna (no inició sesión). */
    fun saveFromWebView(site: Site): Boolean {
        val cm = CookieManager.getInstance()
        cm.flush()
        val expires = System.currentTimeMillis() / 1000 + 365L * 24 * 3600
        val lines = site.cookieUrls.flatMap { url -> CookieFile.lines(cm.getCookie(url), URI(url).host, expires) }
        if (lines.isEmpty()) return false
        write(site.key, CookieFile.build(lines))
        return true
    }

    /** Un cookies.txt exportado a mano (por si el sitio no deja iniciar sesión dentro de la app). */
    fun import(site: Site, text: String): Boolean {
        if (!CookieFile.looksValid(text)) return false
        write(site.key, text)
        return true
    }

    private fun write(key: String, text: String) {
        dir.mkdirs()
        val tmp = File(dir, "$key.tmp")
        tmp.writeText(text)
        tmp.renameTo(file(key))
    }

    /** Borra la sesión guardada y las cookies de ese sitio en el WebView de inicio de sesión. */
    fun logout(site: Site) {
        file(site.key).delete()
        val cm = CookieManager.getInstance()
        for (url in site.cookieUrls) {
            val host = URI(url).host
            val domain = host.removePrefix("www.").removePrefix("m.")
            cm.getCookie(url)?.split(";")?.mapNotNull { it.substringBefore('=', "").trim().takeIf { n -> n.isNotEmpty() } }?.forEach { name ->
                cm.setCookie(url, "$name=; Max-Age=0; Path=/")
                cm.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=.$domain")
            }
        }
        cm.flush()
    }
}
