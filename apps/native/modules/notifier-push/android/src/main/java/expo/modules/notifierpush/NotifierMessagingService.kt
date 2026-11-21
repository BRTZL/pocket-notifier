package expo.modules.notifierpush

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives notifier's data-only pushes and posts the notification natively, so no
 * JavaScript has to start and it works while the app is not running.
 */
class NotifierMessagingService : FirebaseMessagingService() {
  private companion object {
    const val TAG = "NotifierPush"
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    try {
      when (val push = PushPayload.parse(remoteMessage.data)) {
        is Push.Message -> {
          // Already on a background thread: download the icon and picture first (bounded),
          // then build the notification from the cache.
          PushMedia.prefetch(applicationContext, push.message)
          PushNotifications.show(applicationContext, push.message)
        }
        is Push.Dismiss -> PushNotifications.cancel(applicationContext, push.ids)
        // Unknown version or kind: a newer server; ignore rather than show something wrong.
        null -> Log.i(TAG, "ignored push v=${remoteMessage.data["v"]} kind=${remoteMessage.data["kind"]}")
      }
    } catch (error: Exception) {
      // A bad payload must never crash the app's process.
      Log.e(TAG, "could not handle push: ${error.javaClass.simpleName}")
    }
  }

  override fun onNewToken(token: String) {
    SessionStore.saveToken(applicationContext, token)
    NotifierPushModule.emitToken(token)
  }
}
