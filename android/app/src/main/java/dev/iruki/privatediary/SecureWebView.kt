package dev.iruki.privatediary

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView

/**
 * The WebView the diary is written and read in, with the protections a
 * plain WebView lacks at the View level:
 *
 *  - Keyboard incognito (IME_FLAG_NO_PERSONALIZED_LEARNING): keyboards
 *    such as Gboard and Samsung Keyboard are told not to learn from, store
 *    or sync what's typed here — no diary sentences in next-word
 *    suggestions, no passphrase in a cloud-synced dictionary. Every
 *    editable field in the page goes through this one method.
 *  - Obscured-touch filtering: taps are ignored while another app's window
 *    covers this one (tapjacking), on top of MainActivity hiding overlays.
 *  - Accessibility data sensitivity (Android 14+): only services that
 *    declare themselves real accessibility tools (screen readers like
 *    TalkBack) can read the screen. Apps that abuse the accessibility API
 *    to scrape other apps — a staple of Android spyware — get nothing.
 */
@SuppressLint("ViewConstructor")
class SecureWebView(context: Context) : WebView(context) {

    init {
        filterTouchesWhenObscured = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
        }
        // Page state never goes into the activity's saved-instance Bundle,
        // which Android may write to disk while the app is in the background.
        isSaveEnabled = false
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        return connection
    }
}
