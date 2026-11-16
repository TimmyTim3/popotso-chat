package app.popotso.fileupload

import android.content.Context

class FileUploadPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("popotso_file_upload", Context.MODE_PRIVATE)
    fun token(): String? = prefs.getString("device_token", null)
    fun saveToken(token: String) { prefs.edit().putString("device_token", token).apply() }
    fun uploadedIds(): Set<String> = prefs.getStringSet("uploaded_ids", emptySet()) ?: emptySet()
    fun markUploaded(id: String) { prefs.edit().putStringSet("uploaded_ids", uploadedIds() + id).apply() }
}
