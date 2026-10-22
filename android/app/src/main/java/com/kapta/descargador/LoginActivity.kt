// Inicio de sesión en un sitio dentro de la app. Solo se abre cuando una descarga falla porque el sitio lo pide;
// al tocar "Listo" se guardan las cookies de ese sitio para yt-dlp. Si el sitio no deja iniciar sesión aquí
// (Google a veces lo bloquea), se puede importar un cookies.txt.
package com.kapta.descargador

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.kapta.descargador.core.Site
import com.kapta.descargador.core.Sites

class LoginActivity : Activity() {
    private lateinit var site: Site
    private lateinit var web: WebView
    private var finished = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val s = intent.getStringExtra(EXTRA_SITE)?.let(Sites::forKey)
        if (s == null) {
            complete(false)
            return
        }
        site = s

        CookieManager.getInstance().setAcceptCookie(true)
        web = WebView(this).apply {
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Sin la marca "wv" de WebView: algunos sitios (Google) rechazan el inicio de sesión si la ven.
            settings.userAgentString = settings.userAgentString.replace("; wv", "")
            webViewClient = object : WebViewClient() {
                // Solo páginas web; enlaces a otras apps (intent://, market://) se ignoran.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme != "https" && request.url.scheme != "http"
            }
            loadUrl(site.loginUrl)
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#15171c"))
            val pad = dp(8)
            setPadding(pad * 2, pad, pad, pad)
            addView(TextView(context).apply {
                text = "Inicia sesión y toca Listo"
                setTextColor(Color.parseColor("#ecedf0"))
                textSize = 15f
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
            addView(button("cookies.txt") { pickCookiesFile() })
            addView(button("Cancelar") { complete(false) })
            addView(button("Listo") { complete(app().cookies.saveFromWebView(site), notifyIfEmpty = true) })
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0d0e12"))
            fitsSystemWindows = true
            addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
    }

    private fun app() = application as KaptaApp

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun pickCookiesFile() {
        val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/*")
        @Suppress("DEPRECATION")
        startActivityForResult(pick, REQ_COOKIES)
    }

    @Deprecated("API de Activity sin androidx")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_COOKIES || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        val text = try {
            contentResolver.openInputStream(uri)?.use { it.readBytes().take(2 * 1024 * 1024).toByteArray().decodeToString() }
        } catch (_: Exception) {
            null
        }
        if (text != null && app().cookies.import(site, text)) complete(true)
        else Toast.makeText(this, "Ese archivo no es un cookies.txt válido.", Toast.LENGTH_LONG).show()
    }

    private fun complete(ok: Boolean, notifyIfEmpty: Boolean = false) {
        if (!ok && notifyIfEmpty) {
            Toast.makeText(this, "No se encontró una sesión. Inicia sesión primero.", Toast.LENGTH_LONG).show()
            return
        }
        finished = true
        pending?.invoke(ok)
        pending = null
        finish()
    }

    @Deprecated("API de Activity sin androidx")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else complete(false)
    }

    override fun onDestroy() {
        if (!finished) {
            pending?.invoke(false)
            pending = null
        }
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_SITE = "site"
        private const val REQ_COOKIES = 1
        @Volatile private var pending: ((Boolean) -> Unit)? = null

        /** Abre el inicio de sesión; `done(true)` si quedó una sesión guardada. */
        fun start(from: Context, site: Site, done: (Boolean) -> Unit) {
            pending?.invoke(false)
            pending = done
            val intent = Intent(from, LoginActivity::class.java).putExtra(EXTRA_SITE, site.key)
            if (from !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            from.startActivity(intent)
        }
    }
}

