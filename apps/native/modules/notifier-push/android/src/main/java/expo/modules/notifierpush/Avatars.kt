package expo.modules.notifierpush

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Generated avatars, ported from `packages/contract/src/avatar.ts` so the phone draws the
 * same initials on the same color as the app and the web dashboard. Keep both in sync.
 */
object Avatars {
  val PALETTE = listOf(
    "#E5484D",
    "#F76B15",
    "#FFB224",
    "#30A46C",
    "#12A594",
    "#0090FF",
    "#3E63DD",
    "#8E4EC6",
    "#D6409F",
    "#6F6E77",
  )

  // JS `\s` spelled out: Android's ICU regex and the JVM disagree on what `\s` matches,
  // and Android does not support the `(?U)` flag.
  private val WORD_SEPARATORS =
    Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF._:@/-]+")

  private fun codePoints(text: String): List<String> {
    val result = ArrayList<String>()
    var index = 0
    while (index < text.length) {
      val codePoint = text.codePointAt(index)
      result.add(String(Character.toChars(codePoint)))
      index += Character.charCount(codePoint)
    }
    return result
  }

  /** Up to two letters: first letters of the first two words, or the first two characters. */
  fun initials(name: String): String {
    val words = name.split(WORD_SEPARATORS).map { it.trim() }.filter { it.isNotEmpty() }
    val first = words.getOrNull(0) ?: ""
    val second = words.getOrNull(1)
    val letters = if (second == null) {
      codePoints(first).take(2)
    } else {
      listOfNotNull(codePoints(first).firstOrNull(), codePoints(second).firstOrNull())
    }
    return letters.joinToString("").uppercase().ifEmpty { "?" }
  }

  /** FNV-1a hash of the id, so the same id always gets the same color. */
  fun color(id: String): String {
    var hash = 0x811c9dc5.toInt()
    var index = 0
    while (index < id.length) {
      val codePoint = id.codePointAt(index)
      hash = hash xor codePoint
      hash *= 0x01000193
      index += Character.charCount(codePoint)
    }
    val paletteIndex = (hash.toUInt() % PALETTE.size.toUInt()).toInt()
    return PALETTE[paletteIndex]
  }

  /** A circle in the id's color with the name's initials in white. */
  fun bitmap(id: String, name: String, sizePx: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val radius = sizePx / 2f
    val circle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor(color(id)) }
    canvas.drawCircle(radius, radius, radius, circle)

    val text = initials(name)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textAlign = Paint.Align.CENTER
      textSize = sizePx * (if (text.length > 1) 0.38f else 0.46f)
    }
    val baseline = radius - (paint.descent() + paint.ascent()) / 2f
    canvas.drawText(text, radius, baseline, paint)
    return bitmap
  }
}
