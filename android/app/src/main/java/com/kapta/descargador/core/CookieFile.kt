// Archivo de cookies en formato Netscape (el que lee yt-dlp con --cookies). Sin Android para poder probarlo.
package com.kapta.descargador.core

object CookieFile {
    const val HEADER = "# Netscape HTTP Cookie File"

    /**
     * Líneas Netscape a partir del encabezado "a=b; c=d" que entrega CookieManager para `url`. CookieManager no da el
     * dominio exacto, la ruta ni la expiración de cada cookie: se usan el dominio del sitio con sus subdominios, "/",
     * solo HTTPS y una expiración lejana (el sitio la renueva al usarse).
     */
    fun lines(cookieHeader: String?, host: String, expiresAt: Long): List<String> {
        if (cookieHeader.isNullOrBlank()) return emptyList()
        val domain = "." + host.lowercase().removePrefix("www.").removePrefix("m.")
        return cookieHeader.split(";").mapNotNull { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) return@mapNotNull null
            val name = part.substring(0, eq).trim()
            val value = part.substring(eq + 1).trim()
            if (name.isEmpty() || name.any { it == '\t' || it == '\n' || it == '\r' } || value.any { it == '\t' || it == '\n' || it == '\r' }) {
                return@mapNotNull null
            }
            listOf(domain, "TRUE", "/", "TRUE", expiresAt.toString(), name, value).joinToString("\t")
        }
    }

    /** Contenido completo del archivo, sin cookies repetidas (mismo dominio y nombre). */
    fun build(lines: List<String>): String =
        (listOf(HEADER, "") + lines.distinctBy { it.split('\t').let { f -> f[0] + "\t" + f[5] } }).joinToString("\n") + "\n"

    /** true si el texto parece un cookies.txt válido (para importar uno a mano). */
    fun looksValid(text: String): Boolean =
        text.lineSequence().any { line -> !line.startsWith("#") && line.split('\t').size == 7 }
}
