package dev.iruki.privatediary

import android.app.KeyguardManager
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Biometric check handled exactly like OTP: a gate IN FRONT OF the diary
 * passphrase (components/BiometricGate.tsx, contexts/BiometricGateContext).
 * When it's on, the passphrase can't be entered — or tried — until a
 * fingerprint or face has passed; the backup codes are the one way around
 * it, as they are for OTP. It never stands in for the passphrase, and
 * nothing that can open the diary is kept on the phone — no passphrase, no
 * seed, no key derived from them.
 *
 * What the check is: an ECDSA P-256 signing key generated in Android
 * Keystore (StrongBox if present, else the TEE), usable only right after a
 * Class 3 biometric match (per-use, bound through a CryptoObject). Each
 * check signs a fresh random challenge and verifies the signature with the
 * key's public half. A hooked or faked "success" callback can't produce a
 * valid signature — only the secure hardware can, after a real match.
 *
 *  - Invalidated by biometric enrollment: if a fingerprint or face is added,
 *    the key is destroyed and the check can no longer pass. That does NOT
 *    switch the check off — the diary stays closed until the account owner
 *    re-proves the login (password or Google) and sets it up again.
 *  - Turning it off needs a passing check (like turning off OTP needs a
 *    valid code).
 *  - Per account and per phone; kept across sign-out, so signing out and in
 *    again doesn't remove it.
 *
 * Limit, stated plainly: this is enforced by the app on this phone, not by
 * the server. Clearing the app's data removes it — and the Firebase session
 * with it, so getting back in then needs the login password, the diary
 * passphrase and OTP if it's on.
 */
class BiometricGate(private val context: Context) {

    enum class Availability(val wire: String) {
        READY("ready"),
        NO_HARDWARE("no-hardware"),
        NONE_ENROLLED("none-enrolled"),
        NO_DEVICE_LOCK("no-device-lock"),
        UNAVAILABLE("unavailable"),
    }

    class Status(val availability: Availability, val enabled: Boolean, val invalidated: Boolean, val hardware: String?)

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var inFlight = false

    fun availability(): Availability {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard == null || !keyguard.isDeviceSecure) return Availability.NO_DEVICE_LOCK
        return when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> Availability.READY
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Availability.NONE_ENROLLED
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> Availability.NO_HARDWARE
            else -> Availability.UNAVAILABLE
        }
    }

    fun status(uid: String): Status {
        val availability = availability()
        if (!GateAccount.isValidUid(uid)) return Status(availability, enabled = false, invalidated = false, hardware = null)
        val tag = GateAccount.tag(uid)
        val enabled = prefs.getBoolean(enabledKey(tag), false)
        val invalidated = enabled && signerFor(tag) == null
        return Status(availability, enabled, invalidated, if (enabled) prefs.getString(hardwareKey(tag), null) else null)
    }

    /** Creates the key and proves it works with one check; only then is the gate on. */
    fun enable(activity: FragmentActivity, uid: String, done: (String?) -> Unit) {
        if (!GateAccount.isValidUid(uid)) return done("invalid")
        if (availability() != Availability.READY) return done("unavailable")
        val tag = GateAccount.tag(uid)
        val hardware = try {
            createKey(tag)
        } catch (_: Exception) {
            deleteKey(tag)
            return done("failed")
        } ?: run {
            deleteKey(tag)
            return done("insecure-hardware")
        }
        check(activity, tag, R.string.biometric_enable_title) { error ->
            if (error == null) {
                prefs.edit {
                    putBoolean(enabledKey(tag), true)
                    putString(hardwareKey(tag), hardware)
                }
            } else {
                deleteKey(tag)
            }
            done(error)
        }
    }

    /** The check itself. Null on success, else an error code. */
    fun verify(activity: FragmentActivity, uid: String, done: (String?) -> Unit) {
        if (!GateAccount.isValidUid(uid)) return done("invalid")
        val tag = GateAccount.tag(uid)
        if (!prefs.getBoolean(enabledKey(tag), false)) return done(null)
        check(activity, tag, R.string.biometric_check_title, done)
    }

    /** Turning it off takes a passing check. */
    fun disable(activity: FragmentActivity, uid: String, done: (String?) -> Unit) {
        verify(activity, uid) { error ->
            if (error == null) clear(GateAccount.tag(uid))
            done(error)
        }
    }

    /**
     * After the biometric key was invalidated: the page calls this only once
     * the person has re-proven the login (Firebase reauthentication); the
     * check is then off until they set it up again.
     */
    fun reset(uid: String) {
        if (GateAccount.isValidUid(uid)) clear(GateAccount.tag(uid))
    }

    private fun clear(tag: String) {
        deleteKey(tag)
        prefs.edit {
            remove(enabledKey(tag))
            remove(hardwareKey(tag))
        }
    }

    private fun check(activity: FragmentActivity, tag: String, titleRes: Int, done: (String?) -> Unit) {
        if (inFlight) return done("busy")
        val signer = signerFor(tag) ?: return done("invalidated")
        val challenge = ByteArray(32).also { SecureRandom().nextBytes(it) }
        inFlight = true
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    inFlight = false
                    val signature = result.cryptoObject?.signature ?: return done("failed")
                    done(if (signedByKey(tag, signature, challenge)) null else "failed")
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    inFlight = false
                    done(
                        when (errorCode) {
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_CANCELED -> "cancelled"
                            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
                            else -> "failed"
                        },
                    )
                }
                // onAuthenticationFailed (one unrecognised finger) leaves the prompt up for another try.
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(activity.getString(titleRes))
            .setSubtitle(activity.getString(R.string.biometric_subtitle))
            .setNegativeButtonText(activity.getString(R.string.biometric_cancel))
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(signer))
    }

    /** Signs the challenge with the just-authorized key, verifies with the public key. */
    private fun signedByKey(tag: String, signer: Signature, challenge: ByteArray): Boolean = try {
        signer.update(challenge)
        val signature = signer.sign()
        val publicKey = keyStore().getCertificate(ALIAS_PREFIX + tag)?.publicKey ?: return false
        Signature.getInstance(SIGNATURE).run {
            initVerify(publicKey)
            update(challenge)
            verify(signature)
        }
    } catch (_: Exception) {
        false
    }

    /** A Signature ready for a CryptoObject, or null if the key is gone or invalidated. */
    private fun signerFor(tag: String): Signature? = try {
        val key = keyStore().getKey(ALIAS_PREFIX + tag, null) as? PrivateKey
        key?.let { Signature.getInstance(SIGNATURE).apply { initSign(it) } }
    } catch (_: KeyPermanentlyInvalidatedException) {
        null
    } catch (_: Exception) {
        null
    }

    /** Returns "strongbox" / "tee", or null (and nothing usable) if only software keys are available. */
    private fun createKey(tag: String): String? {
        deleteKey(tag)
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS_PREFIX + tag, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true)
            .setUnlockedDeviceRequired(true)
            .setIsStrongBoxBacked(strongBox)
            .build()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        val pair = try {
            generator.initialize(spec(strongBox = true))
            generator.generateKeyPair()
        } catch (_: StrongBoxUnavailableException) {
            generator.initialize(spec(strongBox = false))
            generator.generateKeyPair()
        }
        return securityLevelOf(pair.private)
    }

    private fun securityLevelOf(key: PrivateKey): String? = try {
        val factory = java.security.KeyFactory.getInstance(key.algorithm, KEYSTORE)
        val info = factory.getKeySpec(key, android.security.keystore.KeyInfo::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            when (info.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT, KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "tee"
                else -> null
            }
        } else {
            @Suppress("DEPRECATION")
            if (info.isInsideSecureHardware) "tee" else null
        }
    } catch (_: Exception) {
        null
    }

    private fun deleteKey(tag: String) {
        try {
            keyStore().deleteEntry(ALIAS_PREFIX + tag)
        } catch (_: Exception) {
            // Nothing to delete.
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun enabledKey(tag: String) = "enabled.$tag"
    private fun hardwareKey(tag: String) = "hardware.$tag"

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS_PREFIX = "privatediary.gate.v1."
        private const val SIGNATURE = "SHA256withECDSA"
        private const val PREFS = "biometric_gate"

        /**
         * Earlier test builds kept the diary seed wrapped by a biometric key
         * ("생체 인증으로 열기"), which let a fingerprint replace the
         * passphrase. That design was withdrawn; this deletes whatever such
         * a build left on the phone — the wrapped seed files and their keys.
         */
        fun removeLegacySeedVault(context: Context) {
            File(context.noBackupFilesDir, "vault").deleteRecursively()
            try {
                val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
                keyStore.aliases().toList()
                    .filter { it.startsWith("privatediary.vault.") }
                    .forEach { keyStore.deleteEntry(it) }
            } catch (_: Exception) {
                // No keystore entries to remove.
            }
        }
    }
}
