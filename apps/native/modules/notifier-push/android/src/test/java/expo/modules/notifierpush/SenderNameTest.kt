package expo.modules.notifierpush

import org.junit.Assert.assertEquals
import org.junit.Test

class SenderNameTest {
  @Test
  fun dropsTheClientSuffix() {
    assertEquals("Claude Code", PushNotifications.shortSenderName("Claude Code (pocket-notifier)"))
    assertEquals("Codex", PushNotifications.shortSenderName("Codex"))
    assertEquals("", PushNotifications.shortSenderName(""))
  }
}
