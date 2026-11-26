package expo.modules.notifierpush

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat

/**
 * Builds and posts notifications for pushes. Every message is its own notification,
 * tagged with the message id (so `dismiss` can cancel it exactly), stacked under a group
 * summary per conversation, or per project without one.
 */
object PushNotifications {
  /** Messages are told apart by tag; the id only separates them from group summaries. */
  const val MESSAGE_ID = 1
  const val SUMMARY_ID = 2
  const val REPLY_KEY = "reply_text"
  private const val ACCENT = 0xFFE94826.toInt()
  private const val MAX_ACTIONS = 3
  /** Web links, the app's own links, and T3 Code threads (opened in T3's app). */
  private val OPENABLE_SCHEMES = setOf("http", "https", "notifier", "t3code")
  private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")

  /** Same as `notificationGroupKey` in `packages/contract/src/push.ts`. */
  fun groupKey(project: String, conversationId: String): String =
    if (conversationId.isNotEmpty()) "project:$project:conversation:$conversationId" else "project:$project"

  private fun manager(context: Context) = NotificationManagerCompat.from(context)

  /**
   * Posts or re-posts a message. `status` shows under the title (e.g. "Sent"); `update`
   * re-posts silently, so an action result never pops up again.
   */
  @SuppressLint("MissingPermission")
  fun show(context: Context, message: PushMessage, status: String? = null, update: Boolean = false) {
    val manager = manager(context)
    if (!manager.areNotificationsEnabled()) {
      return
    }
    Channels.ensure(context)
    val groupKey = groupKey(message.project, message.conversationId)
    val channelId = Channels.id(message.priority)
    val avatarSize = context.resources.getDimensionPixelSize(android.R.dimen.notification_large_icon_width)
      .coerceAtLeast(96)

    // The project as people know it: its display name, else the slug.
    val projectName = message.projectTitle.ifEmpty { message.project }
    val conversationName = message.conversationTitle.ifEmpty { message.conversationId }
    // The conversation icon (the project's first) when it was downloaded, else the
    // generated initials. Only the cache is read: re-posts must not wait on the network.
    val conversationAvatar = PushMedia.icon(context, message.conversationIcon, avatarSize)
      ?: if (message.conversationId.isNotEmpty()) {
        Avatars.bitmap(message.conversationId, conversationName, avatarSize)
      } else {
        Avatars.bitmap(message.project, projectName, avatarSize)
      }
    val pictureUrl = message.attachmentUrl.takeIf { MediaRules.wantsPicture(message) }
    val title = conversationName.ifEmpty { projectName }
    val agent = shortSenderName(message.senderName.ifEmpty { message.senderId })
    // Header line: "Pocket Notifier · <project> · <agent>". The project is left out when it is
    // already the title (project-level thread). An action result ("Sent") replaces it.
    val header = status ?: listOf(projectName.takeIf { it != title }, agent.ifEmpty { null })
      .filterNotNull()
      .joinToString(" · ")
      .ifEmpty { null }

    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(R.drawable.notifier_push_small_icon)
      .setColor(ACCENT)
      .setLargeIcon(conversationAvatar)
      .setContentIntent(tapIntent(context, message))
      .setAutoCancel(true)
      .setGroup(groupKey)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setWhen(message.createdAt)
      .setShowWhen(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(compatPriority(message.priority))
      .setOnlyAlertOnce(update)
      .setSubText(header)

    val pictureUri = pictureUrl?.let { PushMedia.pictureUri(context, it) }
    val text = messageText(message, showsPicture = pictureUri != null)
    if (message.conversationId.isNotEmpty() || message.senderId.isNotEmpty() || message.replies.isNotEmpty()) {
      // One avatar per notification: the conversation speaks as itself, so Android shows a single
      // icon and no sender row. The agent's name moves to the header line.
      val sender = Person.Builder()
        .setKey(groupKey)
        .setName(title)
        .setIcon(IconCompat.createWithBitmap(conversationAvatar))
        .build()
      val me = Person.Builder().setKey("self").setName("You").build()
      val style = NotificationCompat.MessagingStyle(me)
        .setGroupConversation(false)
      style.addMessage(text, message.createdAt, sender)
      if (pictureUri != null) {
        // An image message right under the text; its text is what shows where images can't.
        style.addMessage(
          NotificationCompat.MessagingStyle.Message(
            message.attachmentName.ifEmpty { "Image" },
            message.createdAt,
            sender,
          ).setData(PICTURE_MIME_TYPE, pictureUri),
        )
      }
      for (reply in message.replies) {
        style.addMessage(reply.text, reply.at, null as Person?)
      }
      builder.setStyle(style)
    } else {
      val body = withAttachmentLine(message.body, message, showsPicture = pictureUri != null)
      val picture = if (pictureUri != null) pictureUrl?.let { PushMedia.pictureBitmap(context, it) } else null
      builder
        .setContentTitle(message.title.ifEmpty { projectName })
        .setContentText(body)
        .setStyle(
          if (picture != null) {
            NotificationCompat.BigPictureStyle().bigPicture(picture).setSummaryText(body)
          } else {
            NotificationCompat.BigTextStyle().bigText(body)
          },
        )
    }

    message.actions.take(MAX_ACTIONS).forEachIndexed { index, action ->
      buildAction(context, message, action, index)?.let { builder.addAction(it) }
    }

    manager.notify(message.id, MESSAGE_ID, builder.build())
    postSummary(context, message, groupKey, title)
  }

  /** "Claude Code (pocket-notifier)" -> "Claude Code": the OAuth client's suffix is noise here. */
  internal fun shortSenderName(name: String): String = name.substringBefore(" (").trim()

  /**
   * Any image type works: SystemUI only checks the `image/` prefix and decodes the file
   * (stored as JPEG or PNG).
   */
  private const val PICTURE_MIME_TYPE = "image/jpeg"

  /** The body plus "Attachment: <name>" unless the attachment is shown as the picture. */
  internal fun withAttachmentLine(body: String, message: PushMessage, showsPicture: Boolean): String {
    val line = if (showsPicture) null else MediaRules.attachmentLine(message)
    return listOf(body, line).filter { !it.isNullOrEmpty() }.joinToString("\n")
  }

  /** Bold title on the first line, then the body; the messaging style has no title slot. */
  private fun messageText(message: PushMessage, showsPicture: Boolean): CharSequence {
    val body = withAttachmentLine(message.body, message, showsPicture)
    if (message.title.isEmpty()) {
      return body.ifEmpty { "New message" }
    }
    val text = SpannableStringBuilder(message.title)
    text.setSpan(StyleSpan(Typeface.BOLD), 0, message.title.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (body.isNotEmpty()) {
      text.append('\n').append(body)
    }
    return text
  }

  @Suppress("DEPRECATION")
  private fun compatPriority(priority: Int) = when (priority) {
    1 -> NotificationCompat.PRIORITY_MIN
    2 -> NotificationCompat.PRIORITY_LOW
    3 -> NotificationCompat.PRIORITY_DEFAULT
    4 -> NotificationCompat.PRIORITY_HIGH
    else -> NotificationCompat.PRIORITY_MAX
  }

  /**
   * The summary that stacks a group. It never alerts (children do), and it takes the
   * highest priority channel among its children, so a quiet message never mutes an urgent one.
   */
  @SuppressLint("MissingPermission")
  private fun postSummary(context: Context, message: PushMessage, groupKey: String, title: String) {
    val system = context.getSystemService(NotificationManager::class.java) ?: return
    val children = system.activeNotifications.filter {
      it.id == MESSAGE_ID && it.notification.group == groupKey
    }
    val highest = maxOf(
      message.priority,
      children.maxOfOrNull { Channels.priorityOf(channelOf(it.notification)) } ?: 0,
    )
    val count = children.count { it.tag != message.id } + 1
    val summary = NotificationCompat.Builder(context, Channels.id(highest))
      .setSmallIcon(R.drawable.notifier_push_small_icon)
      .setColor(ACCENT)
      .setContentTitle(title)
      .setContentText(if (count == 1) "1 new message" else "$count new messages")
      .setSubText(message.projectTitle.ifEmpty { message.project })
      .setGroup(groupKey)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setOnlyAlertOnce(true)
      .setAutoCancel(true)
      .setContentIntent(tapIntent(context, message))
      .build()
    manager(context).notify(groupKey, SUMMARY_ID, summary)
  }

  private fun channelOf(notification: Notification): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) notification.channelId else null

  /**
   * Cancels the notifications of these message ids, then any group summary left with no
   * messages. Cancelling is asynchronous, so the leftovers are worked out from the ids.
   */
  fun cancel(context: Context, ids: Collection<String>) {
    if (ids.isEmpty()) {
      return
    }
    val system = context.getSystemService(NotificationManager::class.java)
    val active = system?.activeNotifications?.toList() ?: emptyList()
    val manager = manager(context)
    for (id in ids) {
      manager.cancel(id, MESSAGE_ID)
    }
    val cancelled = ids.toSet()
    val remainingGroups = active
      .filter { it.id == MESSAGE_ID && it.tag !in cancelled }
      .mapNotNull { it.notification.group }
      .toSet()
    for (summary in active.filter { it.id == SUMMARY_ID }) {
      if (summary.tag !in remainingGroups) {
        manager.cancel(summary.tag, SUMMARY_ID)
      }
    }
  }

  /**
   * What a tap opens: the message's thread, `notifier://conversation/<projectId>/<key>`.
   * Without a thread it opens the `clickUrl` when it is a web or notifier link, else the
   * inbox.
   */
  fun tapTarget(message: PushMessage): String =
    threadUri(message.projectId, message.conversationKey)
      ?: message.clickUrl.takeIf { isOpenable(it) }
      ?: "notifier://"

  /** The app link of a thread; `null` without both parts. The key may hold `:` and `/`. */
  fun threadUri(projectId: String, conversationKey: String): String? {
    if (projectId.isEmpty() || conversationKey.isEmpty()) {
      return null
    }
    return "notifier://conversation/${encodeSegment(projectId)}/${encodeSegment(conversationKey)}"
  }

  /** Percent-encodes everything but RFC 3986 unreserved characters, like `encodeURIComponent`. */
  fun encodeSegment(value: String): String {
    val out = StringBuilder()
    for (byte in value.toByteArray(Charsets.UTF_8)) {
      val code = byte.toInt() and 0xFF
      val char = code.toChar()
      if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char in "-._~") {
        out.append(char)
      } else {
        out.append('%').append(HEX[code shr 4]).append(HEX[code and 0x0F])
      }
    }
    return out.toString()
  }

  private const val HEX = "0123456789ABCDEF"

  private fun tapIntent(context: Context, message: PushMessage): PendingIntent =
    openIntent(context, Uri.parse(tapTarget(message)))

  fun isOpenable(url: String?): Boolean {
    if (url.isNullOrEmpty()) {
      return false
    }
    // Not `Uri.parse`: this also runs in plain JVM unit tests.
    val scheme = SCHEME.find(url)?.groupValues?.get(1)?.lowercase() ?: return false
    return scheme in OPENABLE_SCHEMES
  }

  /** Opens a URL: notifier links in this app only, web links in the browser. */
  private fun openIntent(context: Context, uri: Uri): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (uri.scheme.equals("notifier", ignoreCase = true)) {
      intent.setPackage(context.packageName)
    }
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun buildAction(
    context: Context,
    message: PushMessage,
    action: PushAction,
    index: Int,
  ): NotificationCompat.Action? {
    return when (action.type) {
      "view" -> {
        val url = action.url?.takeIf { isOpenable(it) } ?: return null
        NotificationCompat.Action.Builder(null, action.label, openIntent(context, Uri.parse(url))).build()
      }
      "http" -> NotificationCompat.Action.Builder(
        null,
        action.label,
        receiverIntent(context, ActionReceiver.ACTION_HTTP, message, index, mutable = false),
      ).build()
      "reply" -> if (action.input) {
        val remoteInput = RemoteInput.Builder(REPLY_KEY)
          .setLabel(action.placeholder ?: action.label)
          .apply { if (action.quickReplies.isNotEmpty()) setChoices(action.quickReplies.toTypedArray()) }
          .build()
        NotificationCompat.Action.Builder(
          null,
          action.label,
          receiverIntent(context, ActionReceiver.ACTION_REPLY, message, index, mutable = true),
        )
          .addRemoteInput(remoteInput)
          .setAllowGeneratedReplies(false)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .setShowsUserInterface(false)
          .build()
      } else {
        NotificationCompat.Action.Builder(
          null,
          action.label,
          receiverIntent(context, ActionReceiver.ACTION_ACK, message, index, mutable = false),
        )
          .setShowsUserInterface(false)
          .build()
      }
      else -> null
    }
  }

  /**
   * An explicit broadcast to `ActionReceiver`. The data URI makes each message and
   * button its own PendingIntent (extras do not count for PendingIntent identity).
   */
  private fun receiverIntent(
    context: Context,
    kind: String,
    message: PushMessage,
    index: Int,
    mutable: Boolean,
  ): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java)
      .setAction(kind)
      .setData(Uri.parse("notifier-push://action/${Uri.encode(message.id)}/$index"))
      .putExtra(ActionReceiver.EXTRA_DATA, PushPayload.toBundle(message.raw))
      .putExtra(ActionReceiver.EXTRA_INDEX, index)
    // RemoteInput fills in the reply, so that one PendingIntent must be mutable; it is
    // explicit, so nothing else can receive it.
    val mutability = if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }
}
