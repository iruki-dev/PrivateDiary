package dev.iruki.privatediary

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * "생체 인증으로 열기": the diary's master seed, wrapped by an AES-256-GCM
 * key that lives in the phone's secure hardware and can only be used right
 * after a strong biometric check.
 *
 * What protects the seed on the phone:
 *  - The wrapping key is generated inside Android Keystore — StrongBox
 *    (a separate security chip) when the phone has one, otherwise the TEE.
 *    It never exists in app memory and can't be exported, so copying the
 *    app's files off the phone yields ciphertext nobody can open.
 *    Software-only keystores (emulators, some broken ROMs) are refused.
 *  - Per-use authentication: every single decryption needs its own
 *    successful BiometricPrompt, bound to that exact operation through a
 *    CryptoObject. There is no "unlocked for 30 seconds" window to ride.
 *  - BIOMETRIC_STRONG only (Class 3 fingerprint/face). The screen-lock PIN
 *    is not accepted as a substitute: a PIN can be watched over a shoulder.
 *  - Invalidated by biometric enrollment: if anyone adds a fingerprint or
 *    face — e.g. someone who learned the PIN — the key is destroyed by the
 *    OS and the passphrase is required again.
 *  - Unlocked-device-required: unusable while the phone is locked.
 *  - Bound to the account: GCM associated data includes the uid.
 *  - Stored in noBackupFilesDir, excluded from backup and device transfer.
 *
 * What it deliberately can't do: change the passphrase, view or reissue
 * backup codes, or anything else in /settings that needs the passphrase.
 * A fingerprint only opens the diary for reading.
 */
class BiometricVault(private val context: Context) {

    enum class Availability(val wire: String) {
        READY("ready"),
        NO_HARDWARE("no-hardware"),
        NONE_ENROLLED("none-enrolled"),
        NO_DEVICE_LOCK("no-device-lock"),
        UNAVAILABLE("unavailable"),
    }

    sealed class Outcome {
        class Success(val seed: ByteArray?) : Outcome()
        class Failure(val code: String) : Outcome()
    }

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

    /** True only if both the wrapped blob and its (still valid) key exist. */
    fun isEnrolled(uid: String): Boolean {
        if (!VaultBlob.isValidUid(uid)) return false
        val tag = VaultBlob.accountTag(uid)
        if (!fileFor(tag).exists()) return false
        val key = loadKey(tag) ?: return false.also { forget(uid) }
        return try {
            Cipher.getInstance(TRANSFORMATION).init(Cipher.ENCRYPT_MODE, key)
            true
        } catch (_: KeyPermanentlyInvalidatedException) {
            // A fingerprint or face was added (or all were removed) since enrollment.
            forget(uid)
            false
        } catch (_: Exception) {
            // UserNotAuthenticatedException etc. — the key exists and is valid.
            true
        }
    }

    /** "strongbox" or "tee" for an enrolled account, null otherwise. */
    fun hardwareLevel(uid: String): String? {
        if (!VaultBlob.isValidUid(uid)) return null
        val key = loadKey(VaultBlob.accountTag(uid)) ?: return null
        return securityLevelOf(key)
    }

    /**
     * Wraps `seed` for `uid` after a biometric check. Takes ownership of
     * `seed` and zeroes it whatever the outcome.
     */
    fun enroll(activity: FragmentActivity, uid: String, seed: ByteArray, done: (Outcome) -> Unit) {
        if (!VaultBlob.isValidUid(uid) || seed.size != VaultBlob.SEED_BYTES) {
            seed.fill(0)
            return done(Outcome.Failure("invalid"))
        }
        if (availability() != Availability.READY) {
            seed.fill(0)
            return done(Outcome.Failure("unavailable"))
        }
        val tag = VaultBlob.accountTag(uid)
        val cipher = try {
            val key = createKey(tag)
            if (securityLevelOf(key) == null) {
                deleteKey(tag)
                seed.fill(0)
                return done(Outcome.Failure("insecure-hardware"))
            }
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }
        } catch (_: Exception) {
            deleteKey(tag)
            seed.fill(0)
            return done(Outcome.Failure("failed"))
        }
        authenticate(
            activity,
            cipher,
            title = activity.getString(R.string.biometric_enroll_title),
            subtitle = activity.getString(R.string.biometric_enroll_subtitle),
            negative = activity.getString(R.string.biometric_cancel),
            onError = { code ->
                seed.fill(0)
                deleteKey(tag)
                done(Outcome.Failure(code))
            },
        ) { authorized ->
            try {
                authorized.updateAAD(VaultBlob.associatedData(uid))
                val ciphertext = authorized.doFinal(seed)
                write(tag, VaultBlob.encode(authorized.iv, ciphertext))
                done(Outcome.Success(null))
            } catch (_: Exception) {
                deleteKey(tag)
                done(Outcome.Failure("failed"))
            } finally {
                seed.fill(0)
            }
        }
    }

    /** Biometric check, then returns the seed. The caller must zero it after use. */
    fun unlock(activity: FragmentActivity, uid: String, done: (Outcome) -> Unit) {
        if (!VaultBlob.isValidUid(uid)) return done(Outcome.Failure("invalid"))
        val tag = VaultBlob.accountTag(uid)
        val blob = read(tag)?.let(VaultBlob::decode) ?: return done(Outcome.Failure("not-enrolled"))
        val key = loadKey(tag) ?: run {
            forget(uid)
            return done(Outcome.Failure("not-enrolled"))
        }
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, blob.iv))
            }
        } catch (_: KeyPermanentlyInvalidatedException) {
            forget(uid)
            return done(Outcome.Failure("invalidated"))
        } catch (_: Exception) {
            return done(Outcome.Failure("failed"))
        }
        authenticate(
            activity,
            cipher,
            title = activity.getString(R.string.biometric_unlock_title),
            subtitle = null,
            negative = activity.getString(R.string.biometric_use_passphrase),
            onError = { code -> done(Outcome.Failure(code)) },
        ) { authorized ->
            try {
                authorized.updateAAD(VaultBlob.associatedData(uid))
                done(Outcome.Success(authorized.doFinal(blob.ciphertext)))
            } catch (_: Exception) {
                // Tag mismatch: the blob was altered, or doesn't belong to this account.
                forget(uid)
                done(Outcome.Failure("invalidated"))
            }
        }
    }

    fun forget(uid: String) {
        if (!VaultBlob.isValidUid(uid)) return
        val tag = VaultBlob.accountTag(uid)
        deleteKey(tag)
        fileFor(tag).delete()
    }

    /** Sign-out: nothing of any account stays usable on this phone. */
    fun forgetAll() {
        vaultDir().listFiles()?.forEach { it.delete() }
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        keyStore.aliases().toList().filter { it.startsWith(ALIAS_PREFIX) }.forEach { keyStore.deleteEntry(it) }
    }

    private fun authenticate(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
        subtitle: String?,
        negative: String,
        onError: (String) -> Unit,
        onSuccess: (Cipher) -> Unit,
    ) {
        if (inFlight) return onError("busy")
        inFlight = true
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    inFlight = false
                    val authorized = result.cryptoObject?.cipher
                    if (authorized == null) onError("failed") else onSuccess(authorized)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    inFlight = false
                    onError(
                        when (errorCode) {
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "use-passphrase"
                            BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_CANCELED -> "cancelled"
                            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
                            else -> "failed"
                        },
                    )
                }
                // onAuthenticationFailed (one unrecognised finger) leaves the prompt up for another try.
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { if (subtitle != null) setSubtitle(subtitle) }
            .setNegativeButtonText(negative)
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private fun createKey(tag: String): SecretKey {
        deleteKey(tag)
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(
            ALIAS_PREFIX + tag,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true)
            .setUnlockedDeviceRequired(true)
            .setIsStrongBoxBacked(strongBox)
            .build()

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        return try {
            generator.init(spec(strongBox = true))
            generator.generateKey()
        } catch (_: StrongBoxUnavailableException) {
            generator.init(spec(strongBox = false))
            generator.generateKey()
        }
    }

    /** "strongbox" / "tee", or null if the key is software-only. */
    private fun securityLevelOf(key: SecretKey): String? {
        val info = try {
            SecretKeyFactory.getInstance(key.algorithm, KEYSTORE).getKeySpec(key, KeyInfo::class.java) as KeyInfo
        } catch (_: Exception) {
            return null
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return when (info.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT, KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "tee"
                else -> null
            }
        }
        @Suppress("DEPRECATION")
        return if (info.isInsideSecureHardware) "tee" else null
    }

    private fun loadKey(tag: String): SecretKey? = try {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        keyStore.getKey(ALIAS_PREFIX + tag, null) as? SecretKey
    } catch (_: Exception) {
        null
    }

    private fun deleteKey(tag: String) {
        try {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS_PREFIX + tag)
        } catch (_: Exception) {
            // Nothing to delete.
        }
    }

    private fun vaultDir() = File(context.noBackupFilesDir, "vault").apply { mkdirs() }

    private fun fileFor(tag: String) = File(vaultDir(), "$tag.bin")

    private fun write(tag: String, bytes: ByteArray) {
        val file = AtomicFile(fileFor(tag))
        val out = file.startWrite()
        try {
            out.write(bytes)
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }

    private fun read(tag: String): ByteArray? = try {
        AtomicFile(fileFor(tag)).takeIf { it.baseFile.exists() }?.readFully()
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS_PREFIX = "privatediary.vault.v1."
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}
