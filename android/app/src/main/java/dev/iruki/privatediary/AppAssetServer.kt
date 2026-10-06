package dev.iruki.privatediary

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the bundled web app (assets/web, built by
 * scripts/build-android-web.mjs) to the WebView, answering every request
 * to AppOrigin from the APK itself.
 *
 * Next.js' static export writes `/write` as `write.html`, so a request path
 * is resolved the way a static host would (AssetPaths). Every response
 * carries the same hardening headers the website gets from next.config.ts;
 * the per-page Content-Security-Policy is already inside each HTML file.
 */
class AppAssetServer(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {

    /** Every file under assets/web, listed once — AssetManager can't cheaply say "is this a file?". */
    private val files: Set<String> by lazy {
        val found = HashSet<String>()
        fun walk(dir: String) {
            val children = try {
                assets.list(dir).orEmpty()
            } catch (_: IOException) {
                emptyArray()
            }
            if (children.isEmpty()) {
                found += dir.removePrefix("$ROOT/")
                return
            }
            children.forEach { walk("$dir/$it") }
        }
        walk(ROOT)
        found
    }

    override fun handle(path: String): WebResourceResponse {
        val resolved = AssetPaths.resolve(path) { it in files }
        val (file, status) = when (resolved) {
            null -> AssetPaths.NOT_FOUND_PAGE to 404
            else -> resolved to 200
        }
        val stream = try {
            assets.open("$ROOT/$file")
        } catch (_: IOException) {
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", SECURITY_HEADERS, ByteArrayInputStream(ByteArray(0)))
        }
        val headers = SECURITY_HEADERS + ("Cache-Control" to AssetPaths.cacheControl(file))
        return WebResourceResponse(
            AssetPaths.mimeType(file),
            if (AssetPaths.isText(file)) "utf-8" else null,
            status,
            if (status == 200) "OK" else "Not Found",
            headers,
            stream,
        )
    }

    companion object {
        private const val ROOT = "web"

        /** Same intent as next.config.ts' securityHeaders for the website. */
        val SECURITY_HEADERS: Map<String, String> = mapOf(
            "X-Content-Type-Options" to "nosniff",
            // Firebase requests carry the bare origin at most — never a path.
            "Referrer-Policy" to "strict-origin",
            "Cross-Origin-Opener-Policy" to "same-origin",
            "Cross-Origin-Resource-Policy" to "same-origin",
            "Permissions-Policy" to
                "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), " +
                "serial=(), hid=(), midi=(), display-capture=(), publickey-credentials-get=()",
        )
    }
}

/** Pure path logic, unit-tested in AssetPathsTest. */
object AssetPaths {
    const val NOT_FOUND_PAGE = "404.html"

    /**
     * Maps a request path (without the leading slash, as WebViewAssetLoader
     * passes it) to a bundled file, or null. Rejects anything that tries
     * to climb out of the bundle.
     */
    fun resolve(path: String, exists: (String) -> Boolean): String? {
        val clean = path.substringBefore('?').substringBefore('#').trim('/')
        if (clean.split('/').any { it == ".." || it == "." } || clean.contains('\\') || clean.contains('\u0000')) {
            return null
        }
        if (clean.isEmpty()) return "index.html".takeIf(exists)
        return listOf(clean, "$clean.html", "$clean/index.html").firstOrNull(exists)
    }

    fun mimeType(file: String): String = when (file.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        // Next.js' RSC payloads for client-side navigation.
        "txt" -> "text/x-component"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        else -> "application/octet-stream"
    }

    fun isText(file: String): Boolean = mimeType(file).let { it.startsWith("text/") || it == "application/json" || it == "image/svg+xml" }

    /** Content-hashed build output can be cached forever; pages are re-read every time. */
    fun cacheControl(file: String): String =
        if (file.startsWith("_next/static/")) "public, max-age=31536000, immutable" else "no-cache"
}
