package expo.modules.notifierpush

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * One channel per priority, mirroring `ANDROID_CHANNELS` in `packages/contract/src/push.ts`.
 * Channel IDs are permanent: Android keeps the user's settings per ID, so changing a
 * channel's behaviour needs a new ID.
 */
object Channels {
  private data class Spec(
    val priority: Int,
    val name: String,
    val description: String,
    val importance: Int,
    val sound: Boolean,
    val vibrate: Boolean,
    val bypassDnd: Boolean,
  )

  private val SPECS = listOf(
    Spec(1, "Min priority", "No sound, no status bar icon", NotificationManager.IMPORTANCE_MIN, false, false, false),
    Spec(2, "Low priority", "Shown silently", NotificationManager.IMPORTANCE_LOW, false, false, false),
    Spec(3, "Default priority", "Sound and vibration", NotificationManager.IMPORTANCE_DEFAULT, true, true, false),
    Spec(4, "High priority", "Pops up on screen", NotificationManager.IMPORTANCE_HIGH, true, true, false),
    Spec(
      5,
      "Urgent",
      "Pops up on screen, long vibration, can bypass Do Not Disturb",
      NotificationManager.IMPORTANCE_MAX,
      true,
      true,
      true,
    ),
  )

  private val LONG_VIBRATION = longArrayOf(0, 600, 250, 600, 250, 600)

  fun id(priority: Int) = "priority-$priority"

  /** Priority 1 to 5 of a channel this module created, or 0. */
  fun priorityOf(channelId: String?): Int =
    channelId?.removePrefix("priority-")?.toIntOrNull()?.takeIf { it in 1..5 } ?: 0

  fun ensure(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channels = SPECS.map { spec ->
      NotificationChannel(id(spec.priority), spec.name, spec.importance).apply {
        description = spec.description
        if (!spec.sound) {
          setSound(null, null)
        }
        enableVibration(spec.vibrate)
        if (spec.priority == 5) {
          vibrationPattern = LONG_VIBRATION
        }
        // Only takes effect once the user grants notification policy access.
        setBypassDnd(spec.bypassDnd)
        setShowBadge(spec.priority > 1)
      }
    }
    // Creating an existing channel only updates its name and description.
    manager.createNotificationChannels(channels)
  }
}
