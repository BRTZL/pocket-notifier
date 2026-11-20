import { Image } from "react-native";

import error from "@/assets/images/mascot/error.png";
import inboxEmpty from "@/assets/images/mascot/inbox-empty.png";
import invite from "@/assets/images/mascot/invite.png";
import thinking from "@/assets/images/mascot/thinking.png";
import topicsEmpty from "@/assets/images/mascot/topics-empty.png";
import wave from "@/assets/images/mascot/wave.png";

const POSES = {
  wave,
  "inbox-empty": inboxEmpty,
  "topics-empty": topicsEmpty,
  error,
  invite,
  thinking,
} as const;

export type MascotPose = keyof typeof POSES;

/**
 * Pocket Agent, the app's mascot. Purely decorative: hidden from screen readers, so the
 * text next to it carries the meaning.
 */
export function Mascot({ pose, size = 160 }: { pose: MascotPose; size?: number }) {
  return (
    <Image
      source={POSES[pose]}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
