package dev.iruki.privatediary

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock
import java.util.UUID

/**
 * Copying a backup code (components/SecretCard.tsx).
 *
 *  - Marked sensitive (ClipDescription.EXTRA_IS_SENSITIVE): Android 13+
 *    doesn't show it in the "copied" preview, and keyboards with a
 *    clipboard history are asked not to keep it.
 *  - Cleared again after `clearAfterMs` — but only if the clipboard still
 *    holds this exact copy, so something the user copied afterwards is
 *    never wiped. Android doesn't let a backgrounded app look at the
 *    clipboard, so if the timer fires while the app is in the background
 *    the check is retried the moment the app comes back (onForeground).
 */
class SecureClipboard(context: Context) {
    private val clipboard = context.getSystemService(ClipboardManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var pendingLabel: String? = null
    private var clearAt = 0L

    fun copy(text: String, clearAfterMs: Long) {
        val label = "PrivateDiary ${UUID.randomUUID()}"
        val clip = ClipData.newPlainText(label, text)
        clip.description.extras = PersistableBundle().apply {
            // The same key as a string before Android 13, where several
            // keyboards and OEM clipboards already honour it.
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ClipDescription.EXTRA_IS_SENSITIVE
            } else {
                "android.content.extra.IS_SENSITIVE"
            }
            putBoolean(key, true)
        }
        clipboard.setPrimaryClip(clip)
        pendingLabel = label
        clearAt = SystemClock.elapsedRealtime() + clearAfterMs
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed(::clearIfStillOurs, clearAfterMs)
    }

    fun onForeground() {
        if (pendingLabel != null && SystemClock.elapsedRealtime() >= clearAt) clearIfStillOurs()
    }

    private fun clearIfStillOurs() {
        val label = pendingLabel ?: return
        val current = try {
            clipboard.primaryClipDescription?.label?.toString()
        } catch (_: SecurityException) {
            return // Backgrounded: retried in onForeground().
        } ?: return
        if (current == label) clipboard.clearPrimaryClip()
        pendingLabel = null
    }
}
