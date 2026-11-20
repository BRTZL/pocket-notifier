package expo.modules.notifierpush

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import kotlin.concurrent.thread

/**
 * Runs notification buttons without opening the app: inline replies and one-tap acks
 * go to `responses.create`, `http` actions to the publisher's URL. The notification is
 * then re-posted with the result, or cleared for actions with `clear: true`.
 */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_REPLY = "expo.modules.notifierpush.REPLY"
    const val ACTION_ACK = "expo.modules.notifierpush.ACK"
    const val ACTION_HTTP = "expo.modules.notifierpush.HTTP"
    const val EXTRA_DATA = "data"
    const val EXTRA_INDEX = "index"
    private const val TAG = "NotifierPush"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val kind = intent.action ?: return
    val message = PushPayload.parseMessage(PushPayload.fromBundle(intent.getBundleExtra(EXTRA_DATA))) ?: return
    val action = message.actions.getOrNull(intent.getIntExtra(EXTRA_INDEX, -1)) ?: return
    val replyText = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(PushNotifications.REPLY_KEY)
      ?.toString()?.trim()
    val app = context.applicationContext
    // The network call must not run on the main thread; goAsync keeps the process alive
    // until it finishes (well within the broadcast timeout, as every call stops at 15 s).
    val pending = goAsync()
    thread(name = "notifier-push-action") {
      try {
        handle(app, kind, message, action, replyText)
      } catch (error: Exception) {
        Log.w(TAG, "action failed: ${error.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
    }
  }

  private fun handle(context: Context, kind: String, message: PushMessage, action: PushAction, replyText: String?) {
    when (kind) {
      ACTION_REPLY, ACTION_ACK -> {
        val text = if (kind == ACTION_REPLY) replyText?.takeIf { it.isNotEmpty() } else null
        if (kind == ACTION_REPLY && text == null) {
          // Nothing typed: re-post so Android drops the reply spinner.
          PushNotifications.show(context, message, update = true)
          return
        }
        val session = SessionStore.get(context)
        if (session == null) {
          PushNotifications.show(context, message, status = "Open the app to sign in", update = true)
          return
        }
        try {
          Http.createResponse(session, message.id, action.key, text)
        } catch (failure: ActionFailure) {
          PushNotifications.show(context, message, status = "Not sent: ${failure.message}", update = true)
          return
        }
        if (action.clear) {
          PushNotifications.cancel(context, listOf(message.id))
          return
        }
        val sent = SentReply(text ?: action.label, System.currentTimeMillis())
        val updated = PushPayload.parseMessage(PushPayload.withReply(message, sent)) ?: message
        PushNotifications.show(context, updated, update = true)
      }
      ACTION_HTTP -> {
        try {
          Http.runAction(action)
        } catch (failure: ActionFailure) {
          PushNotifications.show(context, message, status = "${action.label} failed: ${failure.message}", update = true)
          return
        }
        if (action.clear) {
          PushNotifications.cancel(context, listOf(message.id))
        } else {
          PushNotifications.show(context, message, status = "${action.label}: sent", update = true)
        }
      }
    }
  }
}
