package expo.modules.notifierpush

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import android.util.Log
import android.util.LruCache
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Shares stored notification pictures with SystemUI; its own class so it never clashes. */
class NotifierFileProvider : FileProvider()

/**
 * Downloads and caches the images a notification shows: the conversation icon (large
 * icon) and an image attachment (the message picture). Downloads only run in [prefetch],
 * from the FCM service's background thread; building a notification only reads the cache,
 * so re-posts after a notification action never touch the network.
 */
object PushMedia {
  private const val TAG = "NotifierPush"

  /** Total time a push may spend downloading before it is shown anyway. */
  private const val PREFETCH_BUDGET_MS = 8_000L

  /** Icon URLs may be reused for a new image, so a cached icon is refreshed after a day. */
  private const val ICON_MAX_AGE_MS = 24L * 60 * 60 * 1000

  /** Pictures must outlive their notification (SystemUI reads the file later). */
  private const val PICTURE_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
  private const val PICTURE_DIR_MAX_BYTES = 50L * 1024 * 1024

  private const val ICON_DIR = "notifier-push/icons"
  const val PICTURE_DIR = "notifier-push/images"

  /** HTTPS only: a redirect may move between hosts but never to plain HTTP. */
  private val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .followRedirects(true)
      .followSslRedirects(false)
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(5, TimeUnit.SECONDS)
      .callTimeout(7, TimeUnit.SECONDS)
      .build()
  }

  /** Decoded icons by URL and size; a few dozen conversations at most. */
  private val icons = object : LruCache<String, Bitmap>(4 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
  }

  /**
   * Fetches what [message] will show, icon and picture in parallel, waiting at most
   * [PREFETCH_BUDGET_MS] in total. Failures only mean the notification goes without.
   */
  fun prefetch(context: Context, message: PushMessage) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      return
    }
    val jobs = ArrayList<Thread>(2)
    if (MediaRules.isFetchable(message.conversationIcon)) {
      jobs += thread(name = "notifier-push-icon") {
        guarded { iconFile(context, message.conversationIcon, allowNetwork = true) }
      }
    }
    if (MediaRules.wantsPicture(message)) {
      jobs += thread(name = "notifier-push-picture") {
        guarded { pictureFile(context, message.attachmentUrl, allowNetwork = true) }
      }
    }
    val deadline = System.currentTimeMillis() + PREFETCH_BUDGET_MS
    for (job in jobs) {
      job.join((deadline - System.currentTimeMillis()).coerceAtLeast(1))
    }
  }

  private inline fun guarded(block: () -> Unit) {
    try {
      block()
    } catch (error: Throwable) {
      Log.w(TAG, "image download failed: ${error.javaClass.simpleName}")
    }
  }

  /** The conversation icon as a circle of [sizePx], from the cache; `null` when there is none. */
  fun icon(context: Context, url: String, sizePx: Int): Bitmap? {
    if (!MediaRules.isFetchable(url)) {
      return null
    }
    val key = "$sizePx@$url"
    icons.get(key)?.let { return it }
    return try {
      val file = iconFile(context, url, allowNetwork = false) ?: return null
      val decoded = decodeSampled(file, MediaRules.iconDecodeSide(sizePx), MediaRules.iconDecodePixels(sizePx)) ?: return null
      circle(decoded, sizePx).also { icons.put(key, it) }
    } catch (error: Exception) {
      Log.w(TAG, "icon decode failed: ${error.javaClass.simpleName}")
      null
    }
  }

  /**
   * The stored picture of an image attachment as a content URI SystemUI may read, or
   * `null` when it was not downloaded.
   */
  fun pictureUri(context: Context, url: String): Uri? {
    if (!MediaRules.isFetchable(url)) {
      return null
    }
    val file = pictureFile(context, url, allowNetwork = false) ?: return null
    return try {
      val uri = FileProvider.getUriForFile(context, authority(context), file)
      // MessagingStyle images are loaded by SystemUI, outside this app.
      context.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      uri
    } catch (error: Exception) {
      Log.w(TAG, "picture share failed: ${error.javaClass.simpleName}")
      null
    }
  }

  /** The stored picture decoded for `BigPictureStyle`, or `null`. */
  fun pictureBitmap(context: Context, url: String): Bitmap? {
    if (!MediaRules.isFetchable(url)) {
      return null
    }
    val file = pictureFile(context, url, allowNetwork = false) ?: return null
    return decodeSampled(file, MediaRules.PICTURE_DECODE_SIDE, MediaRules.PICTURE_DECODE_PIXELS)
  }

  /** Same as the provider's `android:authorities` in the manifest. */
  fun authority(context: Context) = "${context.packageName}.notifierpush.files"

  /** Raw icon bytes on disk; refreshed when stale, a stale copy still beats no icon. */
  private fun iconFile(context: Context, url: String, allowNetwork: Boolean): File? {
    val file = File(dir(context, ICON_DIR), MediaRules.cacheName(url))
    val isFresh = file.exists() && System.currentTimeMillis() - file.lastModified() < ICON_MAX_AGE_MS
    if (isFresh || !allowNetwork) {
      return file.takeIf { it.exists() }
    }
    val bytes = download(url, MediaRules.ICON_MAX_BYTES) ?: return file.takeIf { it.exists() }
    // Checked before it replaces a working icon.
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (!MediaRules.isDecodable(bounds.outWidth, bounds.outHeight)) {
      return file.takeIf { it.exists() }
    }
    writeAtomically(file, bytes)
    return file
  }

  /**
   * The attachment, downsampled to [MediaRules.PICTURE_MAX_SIDE] and re-encoded, so the
   * stored file is small and known to decode. URLs carry their own token and never change.
   */
  private fun pictureFile(context: Context, url: String, allowNetwork: Boolean): File? {
    val directory = dir(context, PICTURE_DIR)
    val file = File(directory, "${MediaRules.cacheName(url)}.img")
    if (file.exists() || !allowNetwork) {
      return file.takeIf { it.exists() }
    }
    val bytes = download(url, MediaRules.PICTURE_MAX_BYTES) ?: return null
    val decoded = decodeSampled(bytes, MediaRules.PICTURE_DECODE_SIDE, MediaRules.PICTURE_DECODE_PIXELS) ?: return null
    val scale = MediaRules.fitScale(decoded.width, decoded.height, MediaRules.PICTURE_MAX_SIDE)
    val picture = if (scale < 1f) {
      Bitmap.createScaledBitmap(
        decoded,
        (decoded.width * scale).toInt().coerceAtLeast(1),
        (decoded.height * scale).toInt().coerceAtLeast(1),
        true,
      )
    } else {
      decoded
    }
    val out = java.io.ByteArrayOutputStream()
    // PNG keeps transparency (screenshots, diagrams); photos are JPEG.
    val format = if (picture.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
    picture.compress(format, 88, out)
    writeAtomically(file, out.toByteArray())
    evictPictures(directory)
    return file
  }

  private fun download(url: String, maxBytes: Long): ByteArray? {
    if (!MediaRules.isFetchable(url)) {
      return null
    }
    val request = try {
      Request.Builder().url(url).header("Accept", "image/*").build()
    } catch (_: IllegalArgumentException) {
      return null
    }
    client.newCall(request).execute().use { response ->
      if (!response.isSuccessful || !response.request.url.isHttps) {
        return null
      }
      val body = response.body ?: return null
      if (body.contentLength() > maxBytes) {
        return null
      }
      return body.byteStream().use { MediaRules.readCapped(it, maxBytes) }
    }
  }

  private fun dir(context: Context, name: String): File = File(context.cacheDir, name).apply { mkdirs() }

  private fun writeAtomically(file: File, bytes: ByteArray) {
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeBytes(bytes)
    if (!temp.renameTo(file)) {
      temp.delete()
    }
  }

  /** Drops pictures past their age, then the oldest until the folder fits its budget. */
  private fun evictPictures(directory: File) {
    val now = System.currentTimeMillis()
    val files = directory.listFiles()?.filter { it.isFile }?.sortedBy { it.lastModified() } ?: return
    var total = 0L
    val kept = ArrayList<File>()
    for (file in files) {
      if (now - file.lastModified() > PICTURE_MAX_AGE_MS) {
        file.delete()
      } else {
        kept += file
        total += file.length()
      }
    }
    for (file in kept) {
      if (total <= PICTURE_DIR_MAX_BYTES) {
        break
      }
      total -= file.length()
      file.delete()
    }
  }

  private fun decodeSampled(file: File, maxSide: Int, maxPixels: Long): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    // Bounds first: absurd sizes are refused before any pixel memory is allocated.
    if (!MediaRules.isDecodable(bounds.outWidth, bounds.outHeight)) {
      return null
    }
    val options = BitmapFactory.Options().apply {
      inSampleSize = MediaRules.sampleSize(bounds.outWidth, bounds.outHeight, maxSide, maxPixels)
    }
    return BitmapFactory.decodeFile(file.path, options)
  }

  private fun decodeSampled(bytes: ByteArray, maxSide: Int, maxPixels: Long): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    // Bounds first: absurd sizes are refused before any pixel memory is allocated.
    if (!MediaRules.isDecodable(bounds.outWidth, bounds.outHeight)) {
      return null
    }
    val options = BitmapFactory.Options().apply {
      inSampleSize = MediaRules.sampleSize(bounds.outWidth, bounds.outHeight, maxSide, maxPixels)
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  /** Center-cropped to a circle of [sizePx], like the generated avatars. */
  private fun circle(source: Bitmap, sizePx: Int): Bitmap {
    val output = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val side = minOf(source.width, source.height).toFloat()
    val scale = sizePx / side
    val matrix = Matrix().apply {
      setScale(scale, scale)
      postTranslate(-(source.width * scale - sizePx) / 2f, -(source.height * scale - sizePx) / 2f)
    }
    val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
      setLocalMatrix(matrix)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.shader = shader }
    val radius = sizePx / 2f
    Canvas(output).drawCircle(radius, radius, radius, paint)
    return output
  }
}
