package dev.iruki.privatediary

import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * On-disk format of the biometric-wrapped seed (BiometricVault):
 *   [version: 1 byte = 1][iv length: 1 byte][iv][AES-256-GCM ciphertext + 16-byte tag]
 *
 * The ciphertext is bound to the account (GCM associated data = "uid"),
 * so a blob copied between accounts on the same phone won't decrypt.
 * Pure Kotlin, unit-tested in VaultBlobTest.
 */
object VaultBlob {
    private const val VERSION: Byte = 1
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BYTES = 16
    const val SEED_BYTES = 32

    class Parsed(val iv: ByteArray, val ciphertext: ByteArray)

    fun encode(iv: ByteArray, ciphertext: ByteArray): ByteArray {
        require(iv.size == GCM_IV_BYTES) { "unexpected IV size" }
        return ByteBuffer.allocate(2 + iv.size + ciphertext.size)
            .put(VERSION).put(iv.size.toByte()).put(iv).put(ciphertext).array()
    }

    fun decode(bytes: ByteArray): Parsed? {
        if (bytes.size < 2 + GCM_IV_BYTES + GCM_TAG_BYTES + SEED_BYTES) return null
        if (bytes[0] != VERSION || bytes[1].toInt() != GCM_IV_BYTES) return null
        val iv = bytes.copyOfRange(2, 2 + GCM_IV_BYTES)
        val ciphertext = bytes.copyOfRange(2 + GCM_IV_BYTES, bytes.size)
        if (ciphertext.size != SEED_BYTES + GCM_TAG_BYTES) return null
        return Parsed(iv, ciphertext)
    }

    fun associatedData(uid: String): ByteArray = "privatediary.vault.v1|$uid".toByteArray(Charsets.UTF_8)

    /**
     * Keystore alias / file name for an account. Hashed so the Firebase uid
     * isn't written in the clear into the file system or the keystore.
     */
    fun accountTag(uid: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("privatediary.vault|$uid".toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { "%02x".format(it) }
    }

    /** Firebase uids are short ASCII; anything else is refused before touching the keystore. */
    fun isValidUid(uid: String): Boolean = uid.length in 1..128 && uid.all { it.code < 128 && (it.isLetterOrDigit() || it == '-' || it == '_') }
}
