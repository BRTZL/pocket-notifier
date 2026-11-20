package expo.modules.notifierpush

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class NotifierPushModule : Module() {
  companion object {
    @Volatile
    private var current: WeakReference<NotifierPushModule>? = null

    /** Forwards a rotated FCM token to JS, when the app is running. */
    fun emitToken(token: String) {
      current?.get()?.sendEvent("onToken", mapOf("token" to token))
    }
  }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotifierPush")

    Events("onToken")

    OnCreate {
      current = WeakReference(this@NotifierPushModule)
      appContext.reactContext?.let { Channels.ensure(it) }
    }

    OnDestroy {
      if (current?.get() === this@NotifierPushModule) {
        current = null
      }
    }

    AsyncFunction("getToken") { promise: Promise ->
      val context = context
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (task.isSuccessful && task.result != null) {
          SessionStore.saveToken(context, task.result)
          promise.resolve(task.result)
        } else {
          promise.resolve(SessionStore.savedToken(context))
        }
      }
    }

    AsyncFunction("setSession") { serverUrl: String, cookie: String ->
      SessionStore.set(context, PushSession(serverUrl, cookie))
    }

    AsyncFunction("clearSession") {
      SessionStore.clear(context)
    }

    AsyncFunction("ensureChannels") {
      Channels.ensure(context)
    }

    Function("hasPermission") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      val context = context
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result ->
          promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED)
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }
  }
}
