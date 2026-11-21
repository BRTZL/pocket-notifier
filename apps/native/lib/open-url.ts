import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

/** Web links open in the in-app browser. */
const WEB_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Deep-link schemes the app may hand to the system. Everything else (`javascript:`,
 * `intent:`, `file:`, `content:`, `data:`, unknown schemes) comes from message
 * publishers and is refused.
 */
const DEEP_LINK_PROTOCOLS = new Set(["notifier:"]);

/** A message link that is malformed or uses a scheme the app does not open. */
export class UnopenableLinkError extends Error {
  constructor() {
    super("This link can't be opened");
    this.name = "UnopenableLinkError";
  }
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new UnopenableLinkError();
  }
}

/** Opens a message link (click URL or `view` action) if its scheme is allowed. */
export async function openUrl(url: string): Promise<void> {
  const parsed = parseUrl(url);
  if (WEB_PROTOCOLS.has(parsed.protocol)) {
    await WebBrowser.openBrowserAsync(parsed.href);
    return;
  }
  if (DEEP_LINK_PROTOCOLS.has(parsed.protocol)) {
    await Linking.openURL(parsed.href);
    return;
  }
  throw new UnopenableLinkError();
}

/**
 * Opens an attachment's download URL with the system, so Android hands a PDF or file to
 * a viewer app (or the browser downloads it). Only HTTPS URLs from the API are opened.
 */
export async function openAttachmentUrl(url: string): Promise<void> {
  const parsed = parseUrl(url);
  if (parsed.protocol !== "https:") {
    throw new UnopenableLinkError();
  }
  await Linking.openURL(parsed.href);
}
