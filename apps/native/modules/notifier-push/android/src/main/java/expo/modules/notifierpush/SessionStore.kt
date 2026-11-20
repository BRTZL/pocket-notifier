package expo.modules.notifierpush

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Server URL and session cookie, so notification replies work while the app is not running. */
data class PushSession(val serverUrl: String, val cookie: String)

/**
 * Keeps the session in EncryptedSharedPreferences (key in the Android Keystore). The
 * same cookie also lives in SecureStore for the JS app; the app copies it here with
 * `setSession` on start and clears it on sign-out.
 */
@Suppress("DEPRECATION")
object SessionStore {
  private const val FILE = "notifier_push_session"
  private const val SERVER_URL = "serverUrl"
  private const val COOKIE = "cookie"
  private const val TOKEN_FILE = "notifier_push"
  private const val TOKEN = "token"

  @Volatile
  private var cached: SharedPreferences? = null

  private fun create(context: Context): SharedPreferences {
    val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    return EncryptedSharedPreferences.create(
      context,
      FILE,
      key,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  @Synchronized
  private fun prefs(context: Context): SharedPreferences {
    cached?.let { return it }
    val app = context.applicationContext
    val prefs = try {
      create(app)
    } catch (error: Exception) {
      // A restored backup or a reset keystore leaves a file that no longer decrypts.
      Log.w("NotifierPush", "session store unreadable, resetting")
      app.deleteSharedPreferences(FILE)
      create(app)
    }
    cached = prefs
    return prefs
  }

  fun get(context: Context): PushSession? {
    val prefs = prefs(context)
    val serverUrl = prefs.getString(SERVER_URL, null) ?: return null
    val cookie = prefs.getString(COOKIE, null) ?: return null
    return PushSession(serverUrl.trimEnd('/'), cookie)
  }

  fun set(context: Context, session: PushSession) {
    prefs(context).edit().putString(SERVER_URL, session.serverUrl).putString(COOKIE, session.cookie).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  /** The last FCM token, for `getToken` when Firebase cannot answer (offline). Not a secret on its own. */
  fun saveToken(context: Context, token: String) {
    context.getSharedPreferences(TOKEN_FILE, Context.MODE_PRIVATE).edit().putString(TOKEN, token).apply()
  }

  fun savedToken(context: Context): String? =
    context.getSharedPreferences(TOKEN_FILE, Context.MODE_PRIVATE).getString(TOKEN, null)
}
