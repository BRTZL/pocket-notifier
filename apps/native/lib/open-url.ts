import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

const WEB_URL = /^https?:\/\//iu;

/** Opens web links in the in-app browser and anything else (deep links) with the system. */
export async function openUrl(url: string): Promise<void> {
  if (WEB_URL.test(url)) {
    await WebBrowser.openBrowserAsync(url);
    return;
  }
  await Linking.openURL(url);
}
