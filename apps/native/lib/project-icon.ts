import { PROJECT_ICON_MAX_BYTES, type ProjectIconContentType } from "@notifier/contract/project";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Icons are uploaded as a square of this many pixels. */
export const PROJECT_ICON_SIZE = 256;

/** Encoder qualities tried in order until the icon fits `PROJECT_ICON_MAX_BYTES`. */
const QUALITIES = [0.85, 0.7, 0.5, 0.3];

export type EncodedIcon = { contentType: ProjectIconContentType; data: string };

/** Bytes a padded base64 string decodes to. */
export function base64DecodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** The centered square of a `width` x `height` image, in its pixels. */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

/**
 * A picked image as an uploadable icon: center-cropped to a square (the picker's own crop
 * is not guaranteed square on every device), resized to 256 px and encoded as WebP, at
 * lower quality until it fits the contract's size cap. `null` when it never fits.
 */
export async function encodeProjectIcon(image: {
  uri: string;
  width: number;
  height: number;
}): Promise<EncodedIcon | null> {
  const isSquare = image.width > 0 && image.width === image.height;
  // A square (the picker's crop) is decoded small; anything else at full size, so the crop
  // rectangle matches its pixels.
  const context = ImageManipulator.manipulate(
    image.uri,
    isSquare ? { maxWidth: 1024, maxHeight: 1024 } : undefined,
  );
  if (!isSquare && image.width > 0 && image.height > 0) {
    context.crop(centerSquare(image.width, image.height));
  }
  context.resize({ width: PROJECT_ICON_SIZE, height: PROJECT_ICON_SIZE });
  const rendered = await context.renderAsync();
  try {
    for (const compress of QUALITIES) {
      const saved = await rendered.saveAsync({ format: SaveFormat.WEBP, compress, base64: true });
      // Some encoders wrap base64 lines; the contract accepts only the bare alphabet.
      const data = (saved.base64 ?? "").replace(/\s/gu, "");
      if (data.length > 0 && base64DecodedSize(data) <= PROJECT_ICON_MAX_BYTES) {
        return { contentType: "image/webp", data };
      }
    }
    return null;
  } finally {
    rendered.release();
    context.release();
  }
}
