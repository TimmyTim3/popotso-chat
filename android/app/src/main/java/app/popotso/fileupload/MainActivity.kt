package app.popotso.fileupload

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.*

class MainActivity : Activity() {
    private lateinit var status: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(36, 48, 36, 36) }
        layout.addView(TextView(this).apply { text = "Popotso File Upload"; textSize = 24f })
        layout.addView(TextView(this).apply {
            text = "This companion can back up selected images and videos to your family's private Popotso library. It is visible on this device and only runs after you grant Android media access and pair it with a parent account."
            textSize = 16f; setPadding(0, 24, 0, 24)
        })
        status = TextView(this).apply { text = "Not paired"; textSize = 14f }
        layout.addView(status)
        layout.addView(Button(this).apply { text = "Grant media access"; setOnClickListener { requestMediaAccess() } })
        layout.addView(Button(this).apply { text = "Start backup"; setOnClickListener { startBackup() } })
        setContentView(layout)
        status.text = if (FileUploadPrefs(this).token().isNullOrBlank()) "Not paired — enter a pairing code in the app setup." else "Paired. Backup can be started."
    }
    private fun requestMediaAccess() {
        val permissions = if (Build.VERSION.SDK_INT >= 34) arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            else if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
            else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        ActivityCompat.requestPermissions(this, permissions, 41)
    }
    private fun startBackup() {
        if (FileUploadPrefs(this).token().isNullOrBlank()) { status.text = "Pair this device with a parent account before backing up."; return }
        val granted = if (Build.VERSION.SDK_INT >= 33) ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED else ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        if (!granted) { status.text = "Please grant Android media access first."; requestMediaAccess(); return }
        val request = OneTimeWorkRequestBuilder<MediaBackupWorker>().build()
        WorkManager.getInstance(this).enqueueUniqueWork("popotso-media-backup", ExistingWorkPolicy.KEEP, request)
        status.text = "Backup queued. Android will show its backup notification while it runs."
    }
}
