package dev.iruki.privatediary

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultBlobTest {
    private val iv = ByteArray(12) { 7 }
    private val ciphertext = ByteArray(48) { it.toByte() }

    @Test fun roundTrips() {
        val parsed = VaultBlob.decode(VaultBlob.encode(iv, ciphertext))!!
        assertArrayEquals(iv, parsed.iv)
        assertArrayEquals(ciphertext, parsed.ciphertext)
    }

    @Test fun rejectsWrongVersionOrLength() {
        val blob = VaultBlob.encode(iv, ciphertext)
        assertNull(VaultBlob.decode(blob.copyOf().also { it[0] = 2 }))
        assertNull(VaultBlob.decode(blob.copyOf(blob.size - 1)))
        assertNull(VaultBlob.decode(blob + byteArrayOf(0)))
        assertNull(VaultBlob.decode(ByteArray(0)))
    }

    @Test fun accountTagIsStableAndDoesNotRevealUid() {
        val tag = VaultBlob.accountTag("user123")
        assertEquals(tag, VaultBlob.accountTag("user123"))
        assertNotEquals(tag, VaultBlob.accountTag("user124"))
        assertEquals(32, tag.length)
        assertFalse(tag.contains("user123"))
    }

    @Test fun associatedDataBindsTheAccount() {
        assertFalse(VaultBlob.associatedData("a").contentEquals(VaultBlob.associatedData("b")))
    }

    @Test fun uidValidation() {
        assertTrue(VaultBlob.isValidUid("Xy9_-abc"))
        assertFalse(VaultBlob.isValidUid(""))
        assertFalse(VaultBlob.isValidUid("../x"))
        assertFalse(VaultBlob.isValidUid("한글"))
        assertFalse(VaultBlob.isValidUid("a".repeat(129)))
    }
}
