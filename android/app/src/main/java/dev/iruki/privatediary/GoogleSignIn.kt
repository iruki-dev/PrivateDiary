package dev.iruki.privatediary

import android.app.Activity
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Google sign-in for the app. Google refuses its sign-in page inside
 * WebViews (embedded-browser OAuth can be phished and keylogged by the
 * host app), so the app asks Android's Credential Manager for a Google ID
 * token and gives only that token to the page, which exchanges it with
 * Firebase Auth (lib/native/google.ts). The app never sees the Google
 * password; the page never sees anything but the token.
 */
class GoogleSignIn(private val activity: Activity) {

    val isConfigured: Boolean get() = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotEmpty()

    fun requestIdToken(done: (Result<String>) -> Unit) {
        if (!isConfigured) return done(Result.failure(GoogleSignInError("not-configured")))
        val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        CredentialManager.create(activity).getCredentialAsync(
            activity,
            request,
            CancellationSignal(),
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val credential = result.credential
                    if (credential is CustomCredential &&
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    ) {
                        val token = try {
                            GoogleIdTokenCredential.createFrom(credential.data).idToken
                        } catch (_: Exception) {
                            null
                        }
                        if (token != null) return done(Result.success(token))
                    }
                    done(Result.failure(GoogleSignInError("failed")))
                }

                override fun onError(e: GetCredentialException) {
                    done(
                        Result.failure(
                            GoogleSignInError(
                                when (e) {
                                    is GetCredentialCancellationException -> "cancelled"
                                    is NoCredentialException -> "no-account"
                                    else -> "failed"
                                },
                            ),
                        ),
                    )
                }
            },
        )
    }
}

class GoogleSignInError(val code: String) : Exception(code)
