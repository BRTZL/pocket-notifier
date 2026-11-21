package expo.modules.notifierpush

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest

/**
 * The pure parts of loading notification images (no `android.*`), so plain JVM unit tests
 * cover them: which URLs are fetched, how large a download may get, how far to sample a
 * decode, and the cache file names.
 */
object MediaRules {
  /** Largest conversation icon download; icons are uploaded as 256 px squares. */
  const val ICON_MAX_BYTES = 1L * 1024 * 1024

  /** Largest image attachment download for the notification picture. */
  const val PICTURE_MAX_BYTES = 5L * 1024 * 1024

  /** Longest side of the stored notification picture. */
  const val PICTURE_MAX_SIDE = 1440

  private val HTTPS = Regex("^https://[^/?#\\s]+", RegexOption.IGNORE_CASE)

  /** Only HTTPS URLs with a host are downloaded. */
  fun isFetchable(url: String): Boolean = HTTPS.containsMatchIn(url)

  /** Whether this push should show its attachment as the notification's picture. */
  fun wantsPicture(message: PushMessage): Boolean =
    message.attachmentKind == "image" && isFetchable(message.attachmentUrl)

  /** The line a notification gets for an attachment it does not show as a picture. */
  fun attachmentLine(message: PushMessage): String? {
    if (message.attachmentName.isEmpty()) {
      return null
    }
    return "Attachment: ${message.attachmentName}"
  }

  /** Larger than any real photo side; such bounds are a decode bomb or a broken file. */
  const val MAX_SOURCE_SIDE = 16_384

  /** Whether decoded bounds are worth decoding at all. */
  fun isDecodable(width: Int, height: Int): Boolean =
    width in 1..MAX_SOURCE_SIDE && height in 1..MAX_SOURCE_SIDE

  /**
   * The smallest power-of-two `inSampleSize` that keeps the decoded bitmap within
   * [maxSide] on its LONGEST side and within [maxPixels] in total, so no aspect ratio
   * (e.g. a 30000 x 1400 strip) can make a decode allocate past the budget.
   */
  fun sampleSize(width: Int, height: Int, maxSide: Int, maxPixels: Long): Int {
    if (width <= 0 || height <= 0 || maxSide <= 0 || maxPixels <= 0) {
      return 1
    }
    var sample = 1
    while (true) {
      val sampledWidth = (width + sample - 1) / sample
      val sampledHeight = (height + sample - 1) / sample
      if (maxOf(sampledWidth, sampledHeight) <= maxSide && sampledWidth.toLong() * sampledHeight <= maxPixels) {
        return sample
      }
      if (sample >= 1 shl 14) {
        return sample
      }
      sample *= 2
    }
  }

  /** Decode budget for the notification picture: up to 2x its stored side, ~4 MP (16 MiB). */
  const val PICTURE_DECODE_SIDE = PICTURE_MAX_SIDE * 2
  const val PICTURE_DECODE_PIXELS = PICTURE_MAX_SIDE.toLong() * PICTURE_MAX_SIDE * 2

  /** Decode budget for an icon drawn at [sizePx]: up to twice that, square. */
  fun iconDecodeSide(sizePx: Int): Int = sizePx * 2

  fun iconDecodePixels(sizePx: Int): Long = iconDecodeSide(sizePx).toLong() * iconDecodeSide(sizePx)

  /** Scale that fits `width` x `height` within `maxSide` on its longest side (never above 1). */
  fun fitScale(width: Int, height: Int, maxSide: Int): Float {
    val longest = maxOf(width, height)
    if (longest <= 0 || longest <= maxSide) {
      return 1f
    }
    return maxSide.toFloat() / longest
  }

  /** A file name for a URL: its SHA-256 in hex, so tokens in the URL never reach the disk. */
  fun cacheName(url: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }

  /** Reads all of `input`, or `null` once it goes past `maxBytes` (Content-Length may be missing). */
  fun readCapped(input: InputStream, maxBytes: Long): ByteArray? {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) {
        return out.toByteArray()
      }
      total += read
      if (total > maxBytes) {
        return null
      }
      out.write(buffer, 0, read)
    }
  }
}
