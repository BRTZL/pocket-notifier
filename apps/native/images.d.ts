/** Metro resolves image imports to an asset reference that `Image` accepts as `source`. */
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";

  const source: ImageSourcePropType;
  // biome-ignore lint/style/noDefaultExport: an image module's only export is its default.
  export default source;
}
