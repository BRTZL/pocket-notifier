package expo.modules.notifierpush

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class MediaRulesTest {
  private fun message(vararg extra: Pair<String, String>): PushMessage =
    PushPayload.parseMessage(mapOf("id" to "msg_1", "project" to "rezme") + extra)!!

  @Test
  fun onlyFetchesHttpsUrlsWithAHost() {
    assertTrue(MediaRules.isFetchable("https://notifier.example/api/icons/a.webp"))
    assertTrue(MediaRules.isFetchable("HTTPS://cdn.example/x.png"))
    assertFalse(MediaRules.isFetchable("http://cdn.example/x.png"))
    assertFalse(MediaRules.isFetchable("https:///x.png"))
    assertFalse(MediaRules.isFetchable("file:///sdcard/x.png"))
    assertFalse(MediaRules.isFetchable("content://evil/x"))
    assertFalse(MediaRules.isFetchable(""))
  }

  @Test
  fun wantsAPictureOnlyForImagesWithAUrl() {
    assertTrue(
      MediaRules.wantsPicture(message("attachmentKind" to "image", "attachmentUrl" to "https://a.example/i")),
    )
    assertFalse(MediaRules.wantsPicture(message("attachmentKind" to "image")))
    assertFalse(
      MediaRules.wantsPicture(message("attachmentKind" to "video", "attachmentUrl" to "https://a.example/v")),
    )
    assertFalse(
      MediaRules.wantsPicture(message("attachmentKind" to "image", "attachmentUrl" to "http://a.example/i")),
    )
  }

  @Test
  fun attachmentLineNamesTheFileWithoutEmoji() {
    assertEquals("Attachment: report.pdf", MediaRules.attachmentLine(message("attachment" to "report.pdf")))
    assertNull(MediaRules.attachmentLine(message()))
  }

  private fun sampledPixels(width: Int, height: Int, sample: Int): Long =
    ((width + sample - 1) / sample).toLong() * ((height + sample - 1) / sample)

  @Test
  fun samplesByPowersOfTwoWithinTheBudget() {
    val side = MediaRules.PICTURE_DECODE_SIDE
    val pixels = MediaRules.PICTURE_DECODE_PIXELS
    assertEquals(1, MediaRules.sampleSize(1440, 1440, side, pixels))
    assertEquals(1, MediaRules.sampleSize(2000, 1500, side, pixels))
    assertEquals(2, MediaRules.sampleSize(4000, 3000, side, pixels))
    assertEquals(4, MediaRules.sampleSize(8000, 6000, side, pixels))
    assertEquals(1, MediaRules.sampleSize(0, 0, side, pixels))
  }

  @Test
  fun extremeAspectRatiosAreSampledByTheirLongestSide() {
    val side = MediaRules.PICTURE_DECODE_SIDE
    val pixels = MediaRules.PICTURE_DECODE_PIXELS
    // The review's case: a 30000 x 1400 strip used to decode at full size (~160 MiB).
    for ((width, height) in listOf(30_000 to 1_400, 1_400 to 30_000, 16_384 to 1, 1 to 16_384, 16_384 to 16_384)) {
      val sample = MediaRules.sampleSize(width, height, side, pixels)
      val longest = maxOf((width + sample - 1) / sample, (height + sample - 1) / sample)
      assertTrue("$width x $height -> $sample", longest <= side)
      assertTrue("$width x $height -> $sample", sampledPixels(width, height, sample) <= pixels)
      assertTrue("$width x $height -> $sample", sampledPixels(width, height, sample) * 4 <= 16L * 1024 * 1024)
    }
    assertEquals(16, MediaRules.sampleSize(30_000, 1_400, side, pixels))
  }

  @Test
  fun iconsDecodeNearTheirDrawnSize() {
    val size = 192
    val sample = MediaRules.sampleSize(4096, 4096, MediaRules.iconDecodeSide(size), MediaRules.iconDecodePixels(size))
    assertEquals(16, sample)
    assertEquals(1, MediaRules.sampleSize(256, 256, MediaRules.iconDecodeSide(size), MediaRules.iconDecodePixels(size)))
    val strip = MediaRules.sampleSize(30_000, 100, MediaRules.iconDecodeSide(size), MediaRules.iconDecodePixels(size))
    assertTrue((30_000 + strip - 1) / strip <= MediaRules.iconDecodeSide(size))
  }

  @Test
  fun refusesAbsurdBounds() {
    assertTrue(MediaRules.isDecodable(1, 1))
    assertTrue(MediaRules.isDecodable(16_384, 16_384))
    assertFalse(MediaRules.isDecodable(0, 100))
    assertFalse(MediaRules.isDecodable(100, -1))
    assertFalse(MediaRules.isDecodable(16_385, 10))
    assertFalse(MediaRules.isDecodable(10, 100_000))
  }

  @Test
  fun fitsTheLongestSide() {
    assertEquals(1f, MediaRules.fitScale(800, 600, 1440), 0f)
    assertEquals(0.5f, MediaRules.fitScale(2880, 1000, 1440), 0.0001f)
    assertEquals(0.5f, MediaRules.fitScale(1000, 2880, 1440), 0.0001f)
  }

  @Test
  fun cacheNamesHideTheUrl() {
    val name = MediaRules.cacheName("https://a.example/x?t=secret")
    assertEquals(64, name.length)
    assertFalse(name.contains("secret"))
    assertEquals(name, MediaRules.cacheName("https://a.example/x?t=secret"))
    assertNotEquals(name, MediaRules.cacheName("https://a.example/x?t=other"))
  }

  @Test
  fun readsUpToTheCap() {
    val bytes = ByteArray(40_000) { (it % 251).toByte() }
    assertArrayEquals(bytes, MediaRules.readCapped(ByteArrayInputStream(bytes), 40_000))
    assertNull(MediaRules.readCapped(ByteArrayInputStream(bytes), 39_999))
    assertArrayEquals(ByteArray(0), MediaRules.readCapped(ByteArrayInputStream(ByteArray(0)), 10))
  }
}
