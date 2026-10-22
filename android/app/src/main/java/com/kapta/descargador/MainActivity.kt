package com.kapta.descargador

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(KaptaPlugin::class.java)
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    override fun onResume() {
        super.onResume()
        visible = true
    }

    override fun onPause() {
        visible = false
        super.onPause()
    }

    /** "Compartir → Kapta Descargador" desde YouTube, TikTok, el navegador…: se analiza el primer link del texto. */
    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val url = Regex("""https?://\S+""", RegexOption.IGNORE_CASE).find(text)?.value ?: return
        CommandBus.post("analyze", url)
    }

    companion object {
        /** La interfaz está a la vista: no hace falta avisar con notificaciones. */
        @Volatile var visible = false
    }
}

/** Órdenes para la interfaz (AppCommand). Las que llegan antes de que se suscriba se guardan. */
object CommandBus {
    private val pending = mutableListOf<Pair<String, String>>()
    private var listener: ((String, String) -> Unit)? = null

    @Synchronized
    fun post(type: String, url: String) {
        listener?.invoke(type, url) ?: pending.add(type to url)
    }

    @Synchronized
    fun attach(l: (String, String) -> Unit): List<Pair<String, String>> {
        listener = l
        return pending.toList().also { pending.clear() }
    }

    @Synchronized
    fun detach() {
        listener = null
    }
}
