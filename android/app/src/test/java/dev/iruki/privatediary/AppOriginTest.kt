package dev.iruki.privatediary

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppOriginTest {
    @Test fun appUrlIsHttpsOnTheReservedHost() {
        assertTrue(AppOrigin.isAppUrl("https", "appassets.androidplatform.net", -1))
        assertFalse(AppOrigin.isAppUrl("http", "appassets.androidplatform.net", -1))
        assertFalse(AppOrigin.isAppUrl("https", "appassets.androidplatform.net.evil.com", -1))
        assertFalse(AppOrigin.isAppUrl("https", "appassets.androidplatform.net", 8443))
    }

    @Test fun onlyFirebaseEndpointsAreReachable() {
        assertTrue(AppOrigin.isAllowedNetworkRequest("https", "firestore.googleapis.com"))
        assertTrue(AppOrigin.isAllowedNetworkRequest("https", "identitytoolkit.googleapis.com"))
        assertTrue(AppOrigin.isAllowedNetworkRequest("https", "asia-northeast3-demo.cloudfunctions.net"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("http", "firestore.googleapis.com"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("https", "evil.com"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("https", "firestore.googleapis.com.evil.com"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("https", ".cloudfunctions.net"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("https", "cloudfunctions.net.evil.com"))
        assertFalse(AppOrigin.isAllowedNetworkRequest("https", null))
    }

    @Test fun externalLinksAreHttpsOrMailOnly() {
        assertTrue(AppOrigin.isExternalLink("https"))
        assertTrue(AppOrigin.isExternalLink("mailto"))
        assertFalse(AppOrigin.isExternalLink("http"))
        assertFalse(AppOrigin.isExternalLink("intent"))
        assertFalse(AppOrigin.isExternalLink("file"))
        assertFalse(AppOrigin.isExternalLink("javascript"))
    }
}
