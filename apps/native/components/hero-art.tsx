import { Image, View } from "react-native";

import icon from "@/assets/images/icon.png";
import { Mascot, type MascotPose } from "@/components/mascot";

/**
 * The large art card at the top of the signed-out screens: Pocket Agent on the accent
 * color with 32pt corners. Decorative; the headline below carries the meaning.
 */
export function HeroArt({ pose, height = 360 }: { pose?: MascotPose; height?: number }) {
  return (
    <View
      className="bg-accent items-center justify-center overflow-hidden rounded-[32px]"
      style={{ height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pose ? (
        <Mascot pose={pose} size={Math.round(height * 0.78)} />
      ) : (
        <Image
          source={icon}
          resizeMode="cover"
          accessible={false}
          style={{ width: "100%", height: "100%", transform: [{ scale: 1.16 }] }}
        />
      )}
    </View>
  );
}
