import { z } from "zod";

/** How the apps show an attachment: inline image, video player, PDF viewer, or a file row. */
export const AttachmentKind = z.enum(["image", "video", "pdf", "file"]);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/** The kind for a content type; anything not image, video or PDF is a plain file. */
export function attachmentKind(contentType: string): AttachmentKind {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type === "application/pdf") {
    return "pdf";
  }
  return "file";
}
