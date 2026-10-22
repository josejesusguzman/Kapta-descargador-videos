// Sitios en los que se puede iniciar sesión: a partir del link, qué página de inicio de sesión abrir y de qué
// dominios guardar las cookies. Sin Android para poder probarlo en la JVM.
package com.kapta.descargador.core

import java.net.URI

data class Site(val key: String, val loginUrl: String, val cookieUrls: List<String>)

object Sites {
    private val KNOWN = listOf(
        listOf("youtube.com", "youtu.be", "youtube-nocookie.com") to Site(
            "youtube",
            "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
            listOf("https://www.youtube.com", "https://m.youtube.com", "https://accounts.google.com", "https://www.google.com")
        ),
        listOf("instagram.com") to Site("instagram", "https://www.instagram.com/accounts/login/", listOf("https://www.instagram.com")),
        listOf("tiktok.com") to Site("tiktok", "https://www.tiktok.com/login", listOf("https://www.tiktok.com")),
        listOf("facebook.com", "fb.watch", "fb.com") to Site("facebook", "https://m.facebook.com/login/", listOf("https://www.facebook.com", "https://m.facebook.com")),
        listOf("x.com", "twitter.com") to Site("twitter", "https://x.com/i/flow/login", listOf("https://x.com", "https://twitter.com")),
        listOf("vimeo.com") to Site("vimeo", "https://vimeo.com/log_in", listOf("https://vimeo.com")),
        listOf("reddit.com", "redd.it") to Site("reddit", "https://www.reddit.com/login/", listOf("https://www.reddit.com"))
    )

    private fun host(url: String): String? = try {
        URI(url.trim()).host?.lowercase()?.removePrefix("www.")
    } catch (_: Exception) {
        null
    }

    private fun matches(host: String, domain: String) = host == domain || host.endsWith(".$domain")

    /** Sitio del link, o null si no es un link http(s) válido. */
    fun forUrl(url: String): Site? {
        val h = host(url) ?: return null
        for ((domains, site) in KNOWN) if (domains.any { matches(h, it) }) return site
        // Otros sitios: el dominio principal (últimas dos partes), con su página de inicio.
        val parts = h.split('.').filter { it.isNotEmpty() }
        if (parts.size < 2) return null
        val domain = parts.takeLast(2).joinToString(".")
        return Site(domain, "https://$domain/", listOf("https://$domain", "https://www.$domain"))
    }

    /** Sitio por su clave (la que se guarda y viaja a la interfaz), solo con caracteres seguros para un nombre de archivo. */
    fun forKey(key: String): Site? {
        if (!Regex("^[a-z0-9.-]{1,80}$").matches(key) || key.startsWith(".")) return null
        KNOWN.firstOrNull { it.second.key == key }?.let { return it.second }
        return if ('.' in key) forUrl("https://$key/") else null
    }
}
