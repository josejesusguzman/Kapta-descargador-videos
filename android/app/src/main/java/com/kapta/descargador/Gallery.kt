// Copia las descargas a la galería (MediaStore): Películas/Kapta Descargador o Música/Kapta Descargador.
// En Android 10+ no hace falta ningún permiso para guardar ahí archivos propios.
package com.kapta.descargador

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import com.kapta.descargador.core.UserError
import java.io.File

object Gallery {
    const val FOLDER = "Kapta Descargador"

    data class Saved(val uri: Uri, val path: String, val size: Long)

    private fun mimeOf(file: File, audio: Boolean): String {
        val ext = file.extension.lowercase()
        return when (ext) {
            "m4a" -> "audio/mp4"
            "wav" -> "audio/wav"
            "mkv" -> "video/x-matroska"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: if (audio) "audio/mpeg" else "video/mp4"
        }
    }

    /** Copia `file` a la galería y lo borra de la carpeta privada. */
    fun save(ctx: Context, file: File, audio: Boolean): Saved {
        val resolver = ctx.contentResolver
        val collection = if (audio) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val relative = (if (audio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES) + "/" + FOLDER

        // Como en escritorio, bajar otra vez el mismo video reemplaza el archivo anterior (si es de esta app).
        replaceOwn(ctx, collection, relative, file.name)

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeOf(file, audio))
            put(MediaStore.MediaColumns.RELATIVE_PATH, relative)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: throw UserError("No se pudo guardar el archivo en la galería.")
        try {
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out, 1 shl 20) } }
                ?: throw UserError("No se pudo guardar el archivo en la galería.")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            if (e is UserError) throw e
            if (e.message?.contains("ENOSPC") == true || e.message?.contains("No space") == true) {
                throw UserError("No hay espacio suficiente en el teléfono.")
            }
            throw UserError("No se pudo guardar el archivo en la galería.")
        }
        val size = file.length()
        // MediaStore puede renombrar el archivo si ya existe otro igual: se lee el nombre con el que quedó.
        val name = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: file.name
        file.delete()
        @Suppress("DEPRECATION")
        val root = Environment.getExternalStorageDirectory().absolutePath
        return Saved(uri, "$root/$relative/$name", size)
    }

    private fun replaceOwn(ctx: Context, collection: Uri, relative: String, name: String) {
        try {
            ctx.contentResolver.delete(
                collection,
                "${MediaStore.MediaColumns.RELATIVE_PATH} IN (?, ?) AND ${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
                arrayOf(relative, "$relative/", name)
            )
        } catch (_: SecurityException) {
            // Es de otra app (o de una instalación anterior): se guarda con otro nombre.
        }
    }

    /** false si el usuario lo borró desde la galería o desde Archivos. */
    fun exists(ctx: Context, uri: Uri): Boolean = try {
        ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.count > 0 } ?: false
    } catch (_: Exception) {
        false
    }

    fun mimeType(ctx: Context, uri: Uri): String? = try {
        ctx.contentResolver.getType(uri)
    } catch (_: Exception) {
        null
    }
}
