package dev.iruki.privatediary

import org.json.JSONObject
import java.nio.ByteBuffer

/**
 * Wire format between the page (lib/native/bridge.ts) and NativeBridge.
 *
 * Text messages are JSON:
 *   page → app   {"id": 7, "method": "vault.unlock", "params": {...}}
 *   app → page   {"id": 7, "ok": true, "result": {...}}
 *                {"id": 7, "ok": false, "error": "cancelled"}
 *                {"event": "lifecycle", "data": {...}}
 *
 * Secrets (the diary's master seed) never travel as JSON text: a JS string
 * can't be wiped from memory, a byte buffer can. They go as a binary frame
 *   [kind: 1 byte][request id: 4 bytes, big-endian][secret bytes]
 * next to the JSON message with the same id, and both sides zero their
 * copy as soon as it has been used.
 */
object BridgeProtocol {
    const val FRAME_SECRET_TO_APP: Byte = 1
    const val FRAME_SECRET_TO_PAGE: Byte = 2
    private const val HEADER_SIZE = 5
    private const val MAX_TEXT_MESSAGE_CHARS = 8 * 1024 * 1024
    private val METHOD_PATTERN = Regex("^[a-z]+(\\.[a-zA-Z]+)?$")

    data class Request(val id: Int, val method: String, val params: JSONObject)

    class Frame(val kind: Byte, val id: Int, val payload: ByteArray)

    /** Null for anything malformed — the page is ours, so malformed means something is wrong, and it's dropped. */
    fun parseRequest(text: String): Request? {
        if (text.length > MAX_TEXT_MESSAGE_CHARS) return null
        val json = try {
            JSONObject(text)
        } catch (_: Exception) {
            return null
        }
        val id = json.optInt("id", -1)
        val method = json.optString("method", "")
        if (id < 0 || !METHOD_PATTERN.matches(method)) return null
        val params = json.optJSONObject("params") ?: JSONObject()
        return Request(id, method, params)
    }

    fun success(id: Int, result: JSONObject = JSONObject()): String =
        JSONObject().put("id", id).put("ok", true).put("result", result).toString()

    fun failure(id: Int, error: String): String =
        JSONObject().put("id", id).put("ok", false).put("error", error).toString()

    fun event(name: String, data: JSONObject): String =
        JSONObject().put("event", name).put("data", data).toString()

    fun encodeFrame(kind: Byte, id: Int, payload: ByteArray): ByteArray {
        val out = ByteBuffer.allocate(HEADER_SIZE + payload.size)
        out.put(kind).putInt(id).put(payload)
        return out.array()
    }

    /** Copies the payload out; the caller still owns (and should wipe) `bytes`. */
    fun decodeFrame(bytes: ByteArray): Frame? {
        if (bytes.size < HEADER_SIZE) return null
        val buffer = ByteBuffer.wrap(bytes)
        val kind = buffer.get()
        val id = buffer.getInt()
        if (id < 0) return null
        val payload = ByteArray(bytes.size - HEADER_SIZE)
        buffer.get(payload)
        return Frame(kind, id, payload)
    }
}
