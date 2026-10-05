package dev.iruki.privatediary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AssetPathsTest {
    private val files = setOf(
        "index.html", "404.html", "write.html", "write/__next._tree.txt", "docs.html",
        "docs/otp.html", "_next/static/chunks/a.js", "privacy/__next.!KGRvY3Mp.privacy.__PAGE__.txt",
    )
    private fun resolve(path: String) = AssetPaths.resolve(path) { it in files }

    @Test fun rootIsIndex() = assertEquals("index.html", resolve(""))

    @Test fun routeMapsToHtmlFile() {
        assertEquals("write.html", resolve("write"))
        assertEquals("write.html", resolve("write/"))
        assertEquals("docs/otp.html", resolve("docs/otp"))
        assertEquals("docs.html", resolve("docs"))
    }

    @Test fun exactFilesWin() {
        assertEquals("_next/static/chunks/a.js", resolve("_next/static/chunks/a.js"))
        assertEquals("write/__next._tree.txt", resolve("write/__next._tree.txt"))
        assertEquals("privacy/__next.!KGRvY3Mp.privacy.__PAGE__.txt", resolve("privacy/__next.!KGRvY3Mp.privacy.__PAGE__.txt"))
    }

    @Test fun queryIsIgnored() = assertEquals("write.html", resolve("write?_rsc=abc"))

    @Test fun unknownIsNull() = assertNull(resolve("nope"))

    @Test fun traversalIsRefused() {
        assertNull(resolve("../index.html"))
        assertNull(resolve("docs/../write"))
        assertNull(resolve("./write"))
        assertNull(resolve("docs\\otp"))
    }

    @Test fun mimeTypes() {
        assertEquals("text/html", AssetPaths.mimeType("write.html"))
        assertEquals("text/javascript", AssetPaths.mimeType("_next/static/chunks/a.js"))
        assertEquals("text/x-component", AssetPaths.mimeType("write.txt"))
        assertEquals("font/woff2", AssetPaths.mimeType("_next/static/media/x.woff2"))
        assertEquals("application/octet-stream", AssetPaths.mimeType("x.exe"))
    }

    @Test fun onlyHashedOutputIsCachedForever() {
        assertEquals("public, max-age=31536000, immutable", AssetPaths.cacheControl("_next/static/chunks/a.js"))
        assertEquals("no-cache", AssetPaths.cacheControl("write.html"))
    }
}
