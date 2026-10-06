package dev.iruki.privatediary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileNamesTest {
    @Test fun keepsOrdinaryNames() = assertEquals("privatediary-2026-10-05.md", FileNames.sanitize("privatediary-2026-10-05.md"))

    @Test fun stripsPathsAndHiddenPrefixes() {
        assertEquals("_.._etc_passwd", FileNames.sanitize("/../etc/passwd"))
        assertEquals("x.md", FileNames.sanitize("..x.md"))
    }

    @Test fun rejectsEmptyOrHuge() {
        assertNull(FileNames.sanitize(""))
        assertNull(FileNames.sanitize("...."))
        assertNull(FileNames.sanitize("a".repeat(121)))
    }
}
