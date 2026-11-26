package expo.modules.notifierpush

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The wire format is `PushMessageData` in packages/contract/src/push.ts. */
class PushPayloadTest {
  private val projectId = "prj_01jd8x5k2m9q7r4t6v8w0y3z5a"

  private fun data(vararg extra: Pair<String, String>): Map<String, String> =
    mapOf(
      "v" to "2",
      "kind" to "message",
      "id" to "msg_01jd8x5k2m9q7r4t6v8w0y3z5a",
      "project" to "rezme",
      "title" to "Build failed",
      "priority" to "4",
    ) + extra

  private fun message(vararg extra: Pair<String, String>): PushMessage {
    val push = PushPayload.parse(data(*extra))
    assertNotNull(push)
    return (push as Push.Message).message
  }

  @Test
  fun parsesTheThreadFields() {
    val parsed = message(
      "projectId" to projectId,
      "conversationKey" to "c:improving-performance",
      "conversationId" to "improving-performance",
    )
    assertEquals("rezme", parsed.project)
    assertEquals(projectId, parsed.projectId)
    assertEquals("c:improving-performance", parsed.conversationKey)
  }

  @Test
  fun readsTheProjectDisplayName() {
    assertEquals("RezMe", message("projectTitle" to "RezMe").projectTitle)
    assertEquals("", message().projectTitle)
  }

  @Test
  fun opensT3ThreadLinksButNotOtherSchemes() {
    assertTrue(PushNotifications.isOpenable("t3code://threads/env-1/thread%3Adelegated-task%3Aabc"))
    assertFalse(PushNotifications.isOpenable("t3code://new?prompt=rm"))
    assertFalse(PushNotifications.isOpenable("t3code://threads/env-1/abc?x=1"))
    assertTrue(PushNotifications.isOpenable("https://example.com"))
    assertFalse(PushNotifications.isOpenable("intent://x#Intent;end"))
  }

  @Test
  fun dropsVersionOnePayloads() {
    assertNull(PushPayload.parse(data() + ("v" to "1")))
  }

  @Test
  fun needsTheProjectName() {
    assertNull(PushPayload.parse(data() - "project"))
  }

  @Test
  fun tapOpensTheFeatureThread() {
    val parsed = message(
      "projectId" to projectId,
      "conversationKey" to "c:org/repo",
      "clickUrl" to "https://example.com/run/1",
    )
    assertEquals(
      "notifier://conversation/$projectId/c%3Aorg%2Frepo",
      PushNotifications.tapTarget(parsed),
    )
  }

  @Test
  fun tapOpensTheProjectThread() {
    val parsed = message("projectId" to projectId, "conversationKey" to "p:$projectId")
    assertEquals(
      "notifier://conversation/$projectId/p%3A$projectId",
      PushNotifications.tapTarget(parsed),
    )
  }

  @Test
  fun pushesWithoutAThreadFallBackToTheLinkThenTheInbox() {
    assertEquals(
      "https://example.com/run/1",
      PushNotifications.tapTarget(message("clickUrl" to "https://example.com/run/1")),
    )
    assertEquals("notifier://", PushNotifications.tapTarget(message()))
  }

  @Test
  fun encodesKeysLikeEncodeUriComponent() {
    assertEquals("c%3Aa%20b~_.-", PushNotifications.encodeSegment("c:a b~_.-"))
    assertEquals("c%3A%C3%A7a%C4%9Fr%C4%B1", PushNotifications.encodeSegment("c:çağrı"))
  }

  @Test
  fun groupsByProjectAndConversation() {
    assertEquals("project:rezme", PushNotifications.groupKey("rezme", ""))
    assertEquals(
      "project:rezme:conversation:speed",
      PushNotifications.groupKey("rezme", "speed"),
    )
  }

  @Test
  fun parsesTheMediaFields() {
    val parsed = message(
      "conversationIcon" to "https://notifier.example/api/icons/abc.webp",
      "attachment" to "screenshot.png",
      "attachmentKind" to "image",
      "attachmentUrl" to "https://notifier.example/api/attachments/att_1?t=secret",
    )
    assertEquals("https://notifier.example/api/icons/abc.webp", parsed.conversationIcon)
    assertEquals("screenshot.png", parsed.attachmentName)
    assertEquals("image", parsed.attachmentKind)
    assertEquals("https://notifier.example/api/attachments/att_1?t=secret", parsed.attachmentUrl)
  }

  @Test
  fun olderServersWithoutMediaFieldsParseToEmpty() {
    val parsed = message()
    assertEquals("", parsed.conversationIcon)
    assertEquals("", parsed.attachmentName)
    assertEquals("", parsed.attachmentKind)
    assertEquals("", parsed.attachmentUrl)
  }

  @Test
  fun namesAttachmentsThatAreNotShownAsThePicture() {
    val file = message("attachment" to "report.pdf", "attachmentKind" to "pdf")
    assertEquals("Build log\nAttachment: report.pdf", PushNotifications.withAttachmentLine("Build log", file, showsPicture = false))
    assertEquals("Attachment: report.pdf", PushNotifications.withAttachmentLine("", file, showsPicture = false))
    val image = message("attachment" to "shot.png", "attachmentKind" to "image")
    assertEquals("Build log", PushNotifications.withAttachmentLine("Build log", image, showsPicture = true))
    assertEquals("Build log", PushNotifications.withAttachmentLine("Build log", message(), showsPicture = false))
  }
}
