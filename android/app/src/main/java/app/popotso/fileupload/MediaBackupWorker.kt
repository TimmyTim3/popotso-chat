package app.popotso.fileupload

import android.content.ContentUris
import android.provider.MediaStore
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MediaBackupWorker(ctx: android.content.Context, params: WorkerParameters) : Worker(ctx, params) {
    private val prefs = FileUploadPrefs(ctx)
    override fun doWork(): Result {
        val deviceToken = prefs.token() ?: return Result.failure()
        val resolver = applicationContext.contentResolver
        val collection = MediaStore.Files.getContentUri("external")
        val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.MIME_TYPE, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.MEDIA_TYPE)
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE}=? OR ${MediaStore.Files.FileColumns.MEDIA_TYPE}=?"
        val args = arrayOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(), MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString())
        try {
            resolver.query(collection, projection, selection, args, "${MediaStore.Files.FileColumns.DATE_ADDED} DESC")?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
                while (cursor.moveToNext()) {
                    val id = cursor.getString(idCol)
                    if (id in prefs.uploadedIds()) continue
                    val name = cursor.getString(nameCol) ?: "media"
                    val mime = cursor.getString(mimeCol) ?: "application/octet-stream"
                    val size = cursor.getLong(sizeCol)
                    if (size > 50L * 1024 * 1024) continue
                    val uri = ContentUris.withAppendedId(collection, cursor.getLong(idCol))
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: continue
                    if (!upload(deviceToken, id, name, mime, size, bytes)) return Result.retry()
                    prefs.markUploaded(id)
                }
            }
            return Result.success()
        } catch (_: SecurityException) { return Result.failure() } catch (_: Exception) { return Result.retry() }
    }
    private fun request(path: String, token: String, body: JSONObject): JSONObject {
        val conn = (URL(BuildConfig.SUPABASE_URL + path).openConnection() as HttpURLConnection)
        conn.requestMethod = "POST"; conn.doOutput = true; conn.connectTimeout = 20000; conn.readTimeout = 30000
        conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY); conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("x-device-token", token)
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        val text = stream.bufferedReader().use { it.readText() }; val code = conn.responseCode; conn.disconnect()
        if (code !in 200..299) throw IllegalStateException("Upload API failed: $code")
        return JSONObject(text)
    }
    private fun upload(deviceToken: String, mediaId: String, name: String, mime: String, size: Long, bytes: ByteArray): Boolean {
        val grant = request("/functions/v1/file-upload", deviceToken, JSONObject().put("action","create-upload").put("original_name",name).put("content_type",mime).put("file_size",size))
        val path = grant.getString("object_path"); val signedToken = grant.getString("token")
        val uploadUrl = URL(BuildConfig.SUPABASE_URL + "/storage/v1/object/upload/sign/file-upload/" + path + "?token=" + signedToken)
        val conn = uploadUrl.openConnection() as HttpURLConnection
        conn.requestMethod = "PUT"; conn.doOutput = true; conn.connectTimeout = 20000; conn.readTimeout = 60000
        conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY); conn.setRequestProperty("Content-Type", mime)
        conn.outputStream.use { it.write(bytes) }
        val code = conn.responseCode; conn.disconnect()
        if (code !in 200..299) return false
        request("/functions/v1/file-upload", deviceToken, JSONObject().put("action","complete-upload").put("object_path",path).put("original_name",name).put("content_type",mime).put("file_size",size))
        return true
    }
}
