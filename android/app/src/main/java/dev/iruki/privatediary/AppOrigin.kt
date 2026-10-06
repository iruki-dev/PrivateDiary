package dev.iruki.privatediary

/**
 * Where the app's pages live and what they may talk to.
 *
 * The bundled web app is served from `https://appassets.androidplatform.net`
 * — the domain androidx.webkit reserves for exactly this. It never resolves
 * on the network: every request to it is answered from the APK's own assets
 * (AppAssetServer), so the page is a secure context (Web Crypto works)
 * whose code can only be what was signed into the APK.
 */
object AppOrigin {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGIN = "https://$HOST"
    const val START_URL = "$ORIGIN/"

    /**
     * Network hosts the page may reach — Firestore, Firebase Auth and the
     * OTP Cloud Functions, the same list as the page's own CSP
     * (scripts/android-csp.mjs). Enforced a second time natively in
     * MainActivity's shouldInterceptRequest, so even a CSP bypass can't
     * send anything elsewhere.
     */
    private val ALLOWED_NETWORK_HOSTS = setOf(
        "firestore.googleapis.com",
        "identitytoolkit.googleapis.com",
        "securetoken.googleapis.com",
        "www.googleapis.com",
    )
    private const val CLOUD_FUNCTIONS_SUFFIX = ".cloudfunctions.net"

    fun isAppUrl(scheme: String?, host: String?, port: Int): Boolean =
        scheme == "https" && host == HOST && (port == -1 || port == 443)

    fun isAppOrigin(origin: String): Boolean = origin == ORIGIN

    fun isAllowedNetworkRequest(scheme: String?, host: String?): Boolean {
        if (scheme != "https" || host.isNullOrEmpty()) return false
        val h = host.lowercase()
        return h in ALLOWED_NETWORK_HOSTS ||
            (h.endsWith(CLOUD_FUNCTIONS_SUFFIX) && h.length > CLOUD_FUNCTIONS_SUFFIX.length)
    }

    /**
     * Links the page may hand to another app (the docs' GitHub link, a
     * contact address). Everything else a page tries to navigate to —
     * `intent:`, `file:`, `content:`, custom schemes — is dropped.
     */
    fun isExternalLink(scheme: String?): Boolean = scheme == "https" || scheme == "mailto"
}
