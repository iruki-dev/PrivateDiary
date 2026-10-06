package dev.iruki.privatediary

import org.json.JSONObject

/**
 * Wire format between the page (lib/native/bridge.ts) and NativeBridge.
 *
 * Text messages are JSON:
 *   page → app   {"id": 7, "method": "gate.verify", "params": {...}}
 *   app → page   {"id": 7, "ok": true, "result": {...}}
 *                {"id": 7, "ok": false, "error": "cancelled"}
 *                {"event": "lifecycle", "data": {...}}
 *
 * No secret ever crosses this channel: the diary passphrase, the seed and
 * keys derived from them stay in the page, and the native side only
 * answers yes/no questions (was the biometric check passed?) and performs
 * actions the person started (save a file, copy a backup code).
 */
object BridgeProtocol {
    private const val MAX_TEXT_MESSAGE_CHARS = 8 * 1024 * 1024
    private val METHOD_PATTERN = Regex("^[a-z]+(\\.[a-zA-Z]+)?$")

    data class Request(val id: Int, val method: String, val params: JSONObject)

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
}
