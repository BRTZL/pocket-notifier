package expo.modules.notifierpush

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
}
