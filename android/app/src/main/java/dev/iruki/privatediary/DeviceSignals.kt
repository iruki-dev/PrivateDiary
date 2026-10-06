package dev.iruki.privatediary

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import java.io.File

/**
 * Soft warnings about the phone itself, shown in the app's existing
 * security banner (contexts/SecurityContext.tsx) — warned about, never
 * blocked on, same philosophy as lib/security/environmentSignals.ts.
 *
 * Root detection is a cat-and-mouse game a determined attacker always
 * wins, so it is NOT treated as a defence; it's here so a user whose phone
 * is rooted (often without knowing what that means for apps like this)
 * hears it from the app. The defences that matter don't depend on it.
 */
object DeviceSignals {
    fun collect(context: Context): JSONArray {
        val signals = JSONArray()
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard == null || !keyguard.isDeviceSecure) signals.put("no-screen-lock")
        if (looksRooted()) signals.put("rooted")
        if (Settings.Global.getInt(context.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1) {
            signals.put("usb-debugging")
        }
        return signals
    }

    private fun looksRooted(): Boolean {
        if (Build.TAGS?.contains("test-keys") == true) return true
        val paths = listOf(
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su",
            "/data/local/su", "/data/local/bin/su", "/data/local/xbin/su", "/su/bin/su",
            "/system/app/Superuser.apk", "/data/adb/magisk", "/data/adb/ksu",
        )
        return paths.any { runCatching { File(it).exists() }.getOrDefault(false) }
    }
}
