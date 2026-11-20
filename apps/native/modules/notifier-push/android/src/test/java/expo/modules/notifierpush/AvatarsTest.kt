package expo.modules.notifierpush

import org.junit.Assert.assertEquals
import org.junit.Test

/** Expected values come from `avatarInitials` and `avatarColor` in packages/contract/src/avatar.ts. */
class AvatarsTest {
  private val fixtures = listOf(
    Triple("codex", "CO", "#3E63DD"),
    Triple("c:org/repo", "CO", "#F76B15"),
    Triple("notifier-app", "NA", "#8E4EC6"),
    Triple("Claude", "CL", "#0090FF"),
    Triple("ada lovelace", "AL", "#D6409F"),
    Triple("çağrı öz", "ÇÖ", "#8E4EC6"),
    Triple("t5a-agents", "TA", "#FFB224"),
    Triple("Ünïcode_ß", "ÜSS", "#30A46C"),
    Triple("日本語", "日本", "#D6409F"),
    Triple("x", "X", "#0090FF"),
    Triple("ada\u00A0lovelace", "AL", "#E5484D"),
  )

  @Test
  fun matchesTheContract() {
    for ((input, initials, color) in fixtures) {
      assertEquals("initials of $input", initials, Avatars.initials(input))
      assertEquals("color of $input", color, Avatars.color(input))
    }
  }

  @Test
  fun fallsBackToQuestionMark() {
    assertEquals("?", Avatars.initials(""))
    assertEquals("?", Avatars.initials(" -_ "))
  }
}
