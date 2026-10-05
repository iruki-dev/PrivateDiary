package dev.iruki.privatediary

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    @Test fun parsesWellFormedRequests() {
        val request = BridgeProtocol.parseRequest("""{"id":3,"method":"vault.status","params":{"uid":"abc"}}""")!!
        assertEquals(3, request.id)
        assertEquals("vault.status", request.method)
        assertEquals("abc", request.params.getString("uid"))
        assertEquals(0, BridgeProtocol.parseRequest("""{"id":0,"method":"haptic"}""")!!.params.length())
    }

    @Test fun dropsMalformedRequests() {
        assertNull(BridgeProtocol.parseRequest("not json"))
        assertNull(BridgeProtocol.parseRequest("""{"method":"haptic"}"""))
        assertNull(BridgeProtocol.parseRequest("""{"id":-1,"method":"haptic"}"""))
        assertNull(BridgeProtocol.parseRequest("""{"id":1,"method":"../x"}"""))
        assertNull(BridgeProtocol.parseRequest("""{"id":1,"method":"a.b.c"}"""))
        assertNull(BridgeProtocol.parseRequest("""{"id":1}"""))
    }

    @Test fun responsesAndEventsAreJson() {
        val ok = JSONObject(BridgeProtocol.success(4, JSONObject().put("x", 1)))
        assertTrue(ok.getBoolean("ok"))
        assertEquals(1, ok.getJSONObject("result").getInt("x"))
        val fail = JSONObject(BridgeProtocol.failure(4, "cancelled"))
        assertEquals("cancelled", fail.getString("error"))
        val event = JSONObject(BridgeProtocol.event("lifecycle", JSONObject().put("state", "background")))
        assertEquals("lifecycle", event.getString("event"))
    }

    @Test fun framesRoundTrip() {
        val seed = ByteArray(32) { it.toByte() }
        val bytes = BridgeProtocol.encodeFrame(BridgeProtocol.FRAME_SECRET_TO_PAGE, 0x01020304, seed)
        assertEquals(37, bytes.size)
        assertEquals(2.toByte(), bytes[0])
        val frame = BridgeProtocol.decodeFrame(bytes)!!
        assertEquals(BridgeProtocol.FRAME_SECRET_TO_PAGE, frame.kind)
        assertEquals(0x01020304, frame.id)
        assertArrayEquals(seed, frame.payload)
    }

    @Test fun shortOrNegativeFramesAreRejected() {
        assertNull(BridgeProtocol.decodeFrame(ByteArray(4)))
        assertNull(BridgeProtocol.decodeFrame(byteArrayOf(1, -1, -1, -1, -1, 9)))
    }
}
