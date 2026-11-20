package expo.modules.notifierpush

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Why a request from a notification did not go through, shown in the notification. */
class ActionFailure(message: String) : Exception(message)

/**
 * Requests sent from notification buttons. One client with no cookie jar, no redirects
 * (a redirect could point anywhere) and a 15 s overall timeout.
 */
object Http {
  private val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .followRedirects(false)
      .followSslRedirects(false)
      .callTimeout(15, TimeUnit.SECONDS)
      .connectTimeout(10, TimeUnit.SECONDS)
      .build()
  }

  private val JSON = "application/json".toMediaType()

  /** `responses.create` over oRPC, with the stored session cookie. */
  fun createResponse(session: PushSession, messageId: String, actionKey: String, text: String?) {
    val input = JSONObject().put("messageId", messageId).put("actionKey", actionKey)
    if (text != null) {
      input.put("text", text)
    }
    val body = JSONObject().put("json", input).toString().toRequestBody(JSON)
    val request = Request.Builder()
      .url("${session.serverUrl}/rpc/responses/create")
      .header("Cookie", session.cookie)
      .post(body)
      .build()
    execute(request, unauthorized = "Sign in to the app again")
  }

  /** A message's `http` action. The API only accepts HTTPS URLs; checked again here. */
  fun runAction(action: PushAction) {
    val url = action.url ?: throw ActionFailure("No URL")
    if (!url.startsWith("https://", ignoreCase = true)) {
      throw ActionFailure("Only HTTPS actions can be sent")
    }
    val method = action.method.uppercase()
    val body = when (method) {
      "GET" -> null
      "POST", "PUT", "DELETE" -> (action.body ?: "").toRequestBody(null)
      else -> throw ActionFailure("Unsupported method")
    }
    val request = try {
      Request.Builder().url(url).method(method, body).build()
    } catch (_: IllegalArgumentException) {
      throw ActionFailure("The URL is not valid")
    }
    execute(request, unauthorized = null)
  }

  private fun execute(request: Request, unauthorized: String?) {
    val response = try {
      client.newCall(request).execute()
    } catch (_: java.io.InterruptedIOException) {
      throw ActionFailure("Timed out")
    } catch (_: java.io.IOException) {
      throw ActionFailure("No connection")
    }
    response.use {
      if (it.code == 401 && unauthorized != null) {
        throw ActionFailure(unauthorized)
      }
      if (!it.isSuccessful) {
        throw ActionFailure("Server answered ${it.code}")
      }
    }
  }
}
