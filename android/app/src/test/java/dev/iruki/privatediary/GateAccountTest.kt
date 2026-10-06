package dev.iruki.privatediary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GateAccountTest {
    @Test fun tagIsStableAndDoesNotRevealUid() {
        val tag = GateAccount.tag("user123")
        assertEquals(tag, GateAccount.tag("user123"))
        assertNotEquals(tag, GateAccount.tag("user124"))
        assertEquals(32, tag.length)
        assertFalse(tag.contains("user123"))
    }

    @Test fun uidValidation() {
        assertTrue(GateAccount.isValidUid("Xy9_-abc"))
        assertFalse(GateAccount.isValidUid(""))
        assertFalse(GateAccount.isValidUid("../x"))
        assertFalse(GateAccount.isValidUid("한글"))
        assertFalse(GateAccount.isValidUid("a".repeat(129)))
    }
}
