package dev.iruki.privatediary

import android.annotation.SuppressLint
import androidx.core.net.toUri
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject

/**
 * The page's only way to reach native code (lib/native/bridge.ts on the
 * other side; wire format in BridgeProtocol).
 *
 * A WebMessageListener rather than @JavascriptInterface: the listener is
 * only injected into frames whose origin is exactly AppOrigin.ORIGIN, and
 * every message is checked again here for origin and main frame. A
 * @JavascriptInterface object would be exposed to every frame and origin
 * the WebView ever loads. The page's CSP allows no frames at all, so in
 * practice there is exactly one caller: the app's own top-level page.
 *
 * The surface is a short, fixed list of methods; nothing here evaluates
 * strings, loads URLs it is handed (except a user-tapped https/mailto link
 * opened outside the app), or touches files the page names. No secret
 * crosses it in either direction (BridgeProtocol).
 */
// The one WebView feature used here is checked before this class exists:
// MainActivity refuses to start without WEB_MESSAGE_LISTENER.
@SuppressLint("RequiresFeature")
class NativeBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val gate: BiometricGate,
    private val clipboard: SecureClipboard,
    private val google: GoogleSignIn,
) : WebViewCompat.WebMessageListener {

    private var reply: JavaScriptReplyProxy? = null

    fun install() {
        WebViewCompat.addWebMessageListener(webView, JS_OBJECT_NAME, setOf(AppOrigin.ORIGIN), this)
    }

    /** A new page is loading: forget its predecessor's channel. */
    fun reset() {
        reply = null
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: android.net.Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame || !AppOrigin.isAppOrigin(sourceOrigin.toString())) return
        reply = replyProxy
        // Text only; anything else (binary frames) is ignored.
        if (message.type == WebMessageCompat.TYPE_STRING) message.data?.let(::onRequest)
    }

    fun emit(name: String, data: JSONObject = JSONObject()) {
        reply?.postMessage(BridgeProtocol.event(name, data))
    }

    private fun onRequest(text: String) {
        val request = BridgeProtocol.parseRequest(text) ?: return
        val id = request.id
        val params = request.params
        when (request.method) {
            "app.hello" -> ok(id, hello())
            "app.ready" -> {
                activity.onPageReady()
                ok(id)
            }
            "app.autofill" -> {
                // Anything but an explicit true keeps autofill off.
                activity.setAutofillAllowed(params.optBoolean("allowed", false))
                ok(id)
            }
            "gate.status" -> {
                val status = gate.status(params.optString("uid", ""))
                ok(
                    id,
                    JSONObject()
                        .put("availability", status.availability.wire)
                        .put("enabled", status.enabled)
                        .put("invalidated", status.invalidated)
                        .put("hardware", status.hardware ?: JSONObject.NULL),
                )
            }
            "gate.enable" -> withOwnUi(id) { done -> gate.enable(activity, params.optString("uid", ""), done) }
            "gate.verify" -> withOwnUi(id) { done -> gate.verify(activity, params.optString("uid", ""), done) }
            "gate.disable" -> withOwnUi(id) { done -> gate.disable(activity, params.optString("uid", ""), done) }
            "gate.reset" -> {
                gate.reset(params.optString("uid", ""))
                ok(id)
            }
            "clipboard.copySensitive" -> {
                val text = params.optString("text", "")
                if (text.isEmpty() || text.length > 4096) return fail(id, "invalid")
                clipboard.copy(text, params.optLong("clearAfterMs", 30_000L).coerceIn(5_000L, 120_000L))
                ok(id)
            }
            "file.save" -> {
                val name = FileNames.sanitize(params.optString("filename", ""))
                val mime = params.optString("mimeType", "")
                val content = params.optString("content", "")
                if (name == null || mime !in FileNames.ALLOWED_MIME_TYPES) return fail(id, "invalid")
                activity.saveDocument(name, mime, content) { saved -> ok(id, JSONObject().put("saved", saved)) }
            }
            "google.idToken" -> google.requestIdToken { result ->
                result.fold(
                    onSuccess = { ok(id, JSONObject().put("idToken", it)) },
                    onFailure = { fail(id, (it as? GoogleSignInError)?.code ?: "failed") },
                )
            }
            "haptic" -> {
                val constant = when (params.optString("kind")) {
                    "confirm" -> HapticFeedbackConstants.CONFIRM
                    "reject" -> HapticFeedbackConstants.REJECT
                    else -> HapticFeedbackConstants.CLOCK_TICK
                }
                webView.performHapticFeedback(constant)
                ok(id)
            }
            "external.open" -> {
                activity.openExternal(params.optString("url", "").toUri())
                ok(id)
            }
            else -> fail(id, "unknown-method")
        }
    }

    private fun hello(): JSONObject = JSONObject()
        .put("version", BuildConfig.VERSION_NAME)
        .put("versionCode", BuildConfig.VERSION_CODE)
        .put("commit", BuildConfig.BUILD_COMMIT)
        .put(
            "capabilities",
            JSONObject().put("googleSignIn", google.isConfigured),
        )
        .put("signals", DeviceSignals.collect(activity))
        .put("keyboardOpen", activity.keyboardOpen)

    private fun ok(id: Int, result: JSONObject = JSONObject()) {
        reply?.postMessage(BridgeProtocol.success(id, result))
    }

    private fun fail(id: Int, error: String) {
        reply?.postMessage(BridgeProtocol.failure(id, error))
    }

    /** Runs a biometric prompt (the app's own UI — not "leaving the app") and answers with its outcome. */
    private fun withOwnUi(id: Int, run: (done: (String?) -> Unit) -> Unit) {
        activity.whileOwnUiShown()
        run { error ->
            activity.ownUiDone()
            if (error == null) ok(id) else fail(id, error)
        }
    }

    companion object {
        const val JS_OBJECT_NAME = "PrivateDiaryNative"
    }
}

/** File names for "모든 일기 내보내기" (unit-tested in FileNamesTest). */
object FileNames {
    val ALLOWED_MIME_TYPES = setOf("text/markdown", "application/json", "text/plain")

    fun sanitize(name: String): String? {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().trimStart('.')
        if (cleaned.isEmpty() || cleaned.length > 120) return null
        return cleaned
    }
}
