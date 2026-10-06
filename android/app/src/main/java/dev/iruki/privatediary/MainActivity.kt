package dev.iruki.privatediary

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.autofill.AutofillManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The app: one window, one hardened WebView showing the bundled web app.
 *
 * Window-level protections (set before anything is drawn):
 *  - FLAG_SECURE: no screenshots, no screen recording, nothing shown on
 *    casts/mirrors to non-secure displays, and a blank card in the
 *    recent-apps switcher instead of a picture of the open diary.
 *  - setRecentsScreenshotEnabled(false): the recents thumbnail is never
 *    even taken (Android 13+).
 *  - setHideOverlayWindows(true): other apps' floating windows disappear
 *    while the diary is on screen — no tapjacking, no fake prompt drawn
 *    over the passphrase field.
 *
 * Leaving the app (home, app switch, screen off) tells the page, which
 * locks the diary immediately (lib/native/useNativeShell.ts).
 */
class MainActivity : FragmentActivity() {

    private lateinit var container: FrameLayout
    private lateinit var webView: SecureWebView
    private lateinit var bridge: NativeBridge
    private lateinit var gate: BiometricGate
    private lateinit var clipboard: SecureClipboard
    private lateinit var assetLoader: WebViewAssetLoader

    private val createdAt = SystemClock.elapsedRealtime()
    private var pageReady = false
    private var ownUiShown = 0
    private var stoppedAt = 0L
    var keyboardOpen = false
        private set

    private var pendingSave: Pair<String, (Boolean) -> Unit>? = null
    private val createDocument = registerForActivityResult(MimeCreateDocument()) { uri ->
        val (content, done) = pendingSave ?: return@registerForActivityResult
        pendingSave = null
        ownUiDone()
        if (uri == null) return@registerForActivityResult done(false)
        val saved = try {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(content.toByteArray(Charsets.UTF_8)) } != null
        } catch (_: Exception) {
            false
        }
        done(saved)
    }

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        // Saved state is never restored: a restored activity would come
        // back with a blank page anyway, and nothing about the diary
        // should round-trip through a Bundle Android may write to disk.
        super.onCreate(null)
        hardenWindow()
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        // Held until the page says it has rendered (app.ready), so the
        // first thing seen after the icon is the app, not a blank WebView.
        splash.setKeepOnScreenCondition { !pageReady && SystemClock.elapsedRealtime() - createdAt < SPLASH_MAX_MS }

        container = FrameLayout(this)
        setContentView(container)

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            pageReady = true
            showFatal("Android System WebView를 최신 버전으로 업데이트한 뒤 다시 열어주세요.")
            return
        }

        // Remote inspection of the page (chrome://inspect) only in debug builds.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        BiometricGate.removeLegacySeedVault(this)
        gate = BiometricGate(this)
        clipboard = SecureClipboard(this)
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(AppOrigin.HOST)
            .setHttpAllowed(false)
            .addPathHandler("/", AppAssetServer(assets))
            .build()

        createWebView()
        onBackPressedDispatcher.addCallback(this, backCallback)
        applyInsets()
        webView.loadUrl(AppOrigin.START_URL)
    }

    private fun hardenWindow() {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        webView = SecureWebView(this)
        webView.setBackgroundColor(getColor(R.color.background))
        container.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        webView.settings.apply {
            javaScriptEnabled = true
            // Firebase Auth keeps the session in IndexedDB; the app's own
            // sandbox is the only place that lives.
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = textZoomFor(resources.configuration)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // The page has its own dark theme; don't let WebView invert it.
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ATTRIBUTION_REGISTRATION_BEHAVIOR)) {
            WebSettingsCompat.setAttributionRegistrationBehavior(
                webView.settings,
                WebSettingsCompat.ATTRIBUTION_BEHAVIOR_DISABLED,
            )
        }
        // Firebase's web SDK uses no cookies; nothing should be stored as one.
        CookieManager.getInstance().apply {
            setAcceptCookie(false)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.setDownloadListener { _, _, _, _, _ -> /* Downloads go through file.save only. */ }
        // Autofill off by default; the page turns it on for the login password only (setAutofillAllowed).
        webView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS

        webView.webViewClient = AppWebViewClient()
        webView.webChromeClient = AppChromeClient()

        bridge = NativeBridge(this, webView, gate, clipboard, GoogleSignIn(this))
        bridge.install()
    }

    private fun applyInsets() {
        // The page is laid out inside the system bars and display cutout,
        // never under them; the window background (the page's own colour)
        // shows through the transparent bars, so it still reads as one
        // edge-to-edge surface. When the keyboard opens the page shrinks
        // to sit above it, and is told so (the tab bar steps aside).
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, max(bars.bottom, ime.bottom))
            if (imeVisible != keyboardOpen) {
                keyboardOpen = imeVisible
                if (::bridge.isInitialized) bridge.emit("keyboard", JSONObject().put("open", imeVisible))
            }
            WindowInsetsCompat.CONSUMED
        }
        container.setBackgroundColor(getColor(R.color.background))
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::webView.isInitialized) webView.settings.textZoom = textZoomFor(newConfig)
    }

    /** Follows the phone's font size setting, which WebView otherwise ignores. */
    private fun textZoomFor(config: Configuration) = (config.fontScale * 100).roundToInt().coerceIn(85, 200)

    override fun onStart() {
        super.onStart()
        if (!::bridge.isInitialized) return
        clipboard.onForeground()
        val awayMs = if (stoppedAt == 0L) 0L else SystemClock.elapsedRealtime() - stoppedAt
        stoppedAt = 0L
        bridge.emit("lifecycle", JSONObject().put("state", "foreground").put("awayMs", awayMs))
    }

    override fun onStop() {
        super.onStop()
        if (!::bridge.isInitialized || ownUiShown > 0) return
        stoppedAt = SystemClock.elapsedRealtime()
        bridge.emit("lifecycle", JSONObject().put("state", "background"))
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            container.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    // ---- Called by NativeBridge -------------------------------------------------

    fun onPageReady() {
        pageReady = true
    }

    /**
     * Android's autofill (password managers) is off unless the page says
     * otherwise — and it only does for the login password, never while a
     * diary passphrase field is on screen (lib/native/autofill.ts). The
     * passphrase is never stored anywhere, a password manager included.
     * Turning it off also cancels any autofill session already in progress,
     * so nothing typed so far is handed to the service.
     */
    fun setAutofillAllowed(allowed: Boolean) {
        webView.importantForAutofill = if (allowed) {
            View.IMPORTANT_FOR_AUTOFILL_AUTO
        } else {
            View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        if (!allowed) getSystemService(AutofillManager::class.java)?.cancel()
    }

    /** The app's own system UI (biometric prompt, file picker) isn't "leaving the app". */
    fun whileOwnUiShown() {
        ownUiShown += 1
    }

    fun ownUiDone() {
        ownUiShown = max(0, ownUiShown - 1)
    }

    fun saveDocument(filename: String, mimeType: String, content: String, done: (Boolean) -> Unit) {
        if (pendingSave != null) return done(false)
        pendingSave = content to done
        whileOwnUiShown()
        try {
            createDocument.launch(filename to mimeType)
        } catch (_: ActivityNotFoundException) {
            pendingSave = null
            ownUiDone()
            done(false)
        }
    }

    fun openExternal(uri: Uri) {
        if (!AppOrigin.isExternalLink(uri.scheme)) return
        val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.external_link_failed, Toast.LENGTH_SHORT).show()
        }
    }

    private fun showFatal(message: String) {
        container.removeAllViews()
        container.addView(
            TextView(this).apply {
                text = message
                textSize = 16f
                setTextColor(getColor(R.color.foreground))
                setPadding(64, 64, 64, 64)
            },
        )
    }

    // onRenderProcessGone IS implemented below; lint doesn't see it on an inner class.
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class AppWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (AppOrigin.isAppUrl(url.scheme, url.host, url.port)) return assetLoader.shouldInterceptRequest(url)
            if (AppOrigin.isAllowedNetworkRequest(url.scheme, url.host)) return null
            // Second wall behind the page's CSP: nothing else leaves the phone.
            return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (AppOrigin.isAppUrl(url.scheme, url.host, url.port)) return false
            if (request.isForMainFrame && request.hasGesture()) openExternal(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            bridge.reset()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            backCallback.isEnabled = view.canGoBack()
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
            handler.cancel()
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The page's process died (out of memory, or killed). Unlocked
            // keys died with it; start over with a fresh WebView.
            container.removeView(webView)
            webView.destroy()
            createWebView()
            webView.loadUrl(AppOrigin.START_URL)
            Toast.makeText(this@MainActivity, R.string.renderer_gone, Toast.LENGTH_LONG).show()
            return true
        }
    }

    private inner class AppChromeClient : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) =
            callback.invoke(origin, false, false)

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean = false

        override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?) = false

        // The page uses no alert/confirm/prompt; a dialog appearing would
        // be something pretending to be the app. Dismiss them silently.
        override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
            result.cancel()
            return true
        }

        override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
            result.cancel()
            return true
        }

        override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
            result.cancel()
            return true
        }

        override fun onJsBeforeUnload(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
            result.confirm()
            return true
        }

        // Keep the page's console out of logcat in release builds.
        override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean = !BuildConfig.DEBUG
    }

    private companion object {
        const val SPLASH_MAX_MS = 2_500L
    }
}

/** CreateDocument with the MIME type chosen per call. Input: filename to MIME type. */
private class MimeCreateDocument : androidx.activity.result.contract.ActivityResultContract<Pair<String, String>, Uri?>() {
    private val delegate = ActivityResultContracts.CreateDocument("application/octet-stream")

    override fun createIntent(context: android.content.Context, input: Pair<String, String>): Intent =
        delegate.createIntent(context, input.first).setType(input.second)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = delegate.parseResult(resultCode, intent)
}
