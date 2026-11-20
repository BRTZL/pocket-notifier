package expo.modules.notifierpush

import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

/** A notification button, parsed from the push's JSON-encoded `actions`. */
data class PushAction(
  val type: String,
  val key: String,
  val label: String,
  val clear: Boolean,
  val url: String?,
  val method: String,
  val body: String?,
  val input: Boolean,
  val placeholder: String?,
  val quickReplies: List<String>,
)

/** Something the user sent from the notification, shown as their own message. */
data class SentReply(val text: String, val at: Long)

/**
 * The FCM data message, per `PushMessageData` in `packages/contract/src/push.ts`. `raw`
 * keeps the original map so action intents can rebuild the notification later.
 */
data class PushMessage(
  val raw: Map<String, String>,
  val id: String,
  val project: String,
  /** With `conversationKey`, the thread a tap opens; `""` in pushes from older servers. */
  val projectId: String,
  /** `c:<conversation id>` or `p:<project id>`; `""` in pushes from older servers. */
  val conversationKey: String,
  val title: String,
  val body: String,
  val priority: Int,
  val clickUrl: String,
  val actions: List<PushAction>,
  val conversationId: String,
  val conversationTitle: String,
  val senderId: String,
  val senderName: String,
  val truncated: Boolean,
  val createdAt: Long,
  val replies: List<SentReply>,
)

sealed interface Push {
  data class Message(val message: PushMessage) : Push
  data class Dismiss(val ids: List<String>) : Push
}

object PushPayload {
  const val VERSION = "1"

  /** Not part of the wire format: replies sent from the notification, added on rebuild. */
  const val REPLIES_KEY = "_replies"

  /** `null` for an unknown version or kind, or a message without its ids. */
  fun parse(data: Map<String, String>): Push? {
    if (data["v"] != VERSION) {
      return null
    }
    return when (data["kind"]) {
      "message" -> parseMessage(data)?.let { Push.Message(it) }
      "dismiss" -> Push.Dismiss(
        (data["ids"] ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() },
      )
      else -> null
    }
  }

  fun parseMessage(data: Map<String, String>): PushMessage? {
    val id = data["id"]?.takeIf { it.isNotEmpty() } ?: return null
    val project = data["project"]?.takeIf { it.isNotEmpty() } ?: return null
    return PushMessage(
      raw = data,
      id = id,
      project = project,
      projectId = data["projectId"] ?: "",
      conversationKey = data["conversationKey"] ?: "",
      title = data["title"] ?: "",
      body = data["body"] ?: "",
      priority = data["priority"]?.toIntOrNull()?.coerceIn(1, 5) ?: 3,
      clickUrl = data["clickUrl"] ?: "",
      actions = parseActions(data["actions"] ?: ""),
      conversationId = data["conversationId"] ?: "",
      conversationTitle = data["conversationTitle"] ?: "",
      senderId = data["senderId"] ?: "",
      senderName = data["senderName"] ?: "",
      truncated = data["truncated"] == "1",
      createdAt = data["createdAt"]?.toLongOrNull() ?: System.currentTimeMillis(),
      replies = parseReplies(data[REPLIES_KEY] ?: ""),
    )
  }

  private fun parseActions(json: String): List<PushAction> {
    if (json.isEmpty()) {
      return emptyList()
    }
    val array = try {
      JSONArray(json)
    } catch (_: Exception) {
      return emptyList()
    }
    val actions = ArrayList<PushAction>()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      val type = item.optString("type")
      val label = item.optString("label")
      if (type.isEmpty() || label.isEmpty()) {
        continue
      }
      actions.add(
        PushAction(
          type = type,
          key = item.optString("key").ifEmpty { index.toString() },
          label = label,
          clear = item.optBoolean("clear", false),
          url = item.optString("url").takeIf { it.isNotEmpty() },
          method = item.optString("method").ifEmpty { "POST" },
          body = if (item.has("body")) item.optString("body") else null,
          input = item.optBoolean("input", false),
          placeholder = item.optString("placeholder").takeIf { it.isNotEmpty() },
          quickReplies = item.optJSONArray("quickReplies")?.let { replies ->
            (0 until replies.length()).mapNotNull { replies.optString(it).takeIf { text -> text.isNotEmpty() } }
          } ?: emptyList(),
        ),
      )
    }
    return actions
  }

  private fun parseReplies(json: String): List<SentReply> {
    if (json.isEmpty()) {
      return emptyList()
    }
    return try {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { index ->
        array.optJSONObject(index)?.let { SentReply(it.optString("text"), it.optLong("at")) }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  /** The raw map with one more sent reply, for re-posting the notification. */
  fun withReply(message: PushMessage, reply: SentReply): Map<String, String> {
    val array = JSONArray()
    for (existing in message.replies + reply) {
      array.put(JSONObject().put("text", existing.text).put("at", existing.at))
    }
    return message.raw + (REPLIES_KEY to array.toString())
  }

  fun toBundle(data: Map<String, String>): Bundle =
    Bundle().apply { data.forEach { (key, value) -> putString(key, value) } }

  fun fromBundle(bundle: Bundle?): Map<String, String> {
    if (bundle == null) {
      return emptyMap()
    }
    return bundle.keySet().mapNotNull { key -> bundle.getString(key)?.let { key to it } }.toMap()
  }
}
