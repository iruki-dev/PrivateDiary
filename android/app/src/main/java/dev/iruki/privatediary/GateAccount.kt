package dev.iruki.privatediary

import java.security.MessageDigest

/** Per-account names for the biometric gate (pure Kotlin, unit-tested in GateAccountTest). */
object GateAccount {
    /**
     * Keystore alias / preference key for an account. Hashed so the
     * Firebase uid isn't written in the clear into the keystore or prefs.
     */
    fun tag(uid: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("privatediary.gate|$uid".toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { "%02x".format(it) }
    }

    /** Firebase uids are short ASCII; anything else is refused before touching the keystore. */
    fun isValidUid(uid: String): Boolean =
        uid.length in 1..128 && uid.all { it.code < 128 && (it.isLetterOrDigit() || it == '-' || it == '_') }
}
