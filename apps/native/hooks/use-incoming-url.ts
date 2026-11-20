import { useEffect, useState } from "react";
import { Linking } from "react-native";

/**
 * The last link that opened the app: the initial URL, then each `url` event. Kept
 * percent-encoded, as it arrived; the router only reports the decoded path.
 */
export function useIncomingUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let isMounted = true;
    void Linking.getInitialURL().then((initial) => {
      if (isMounted && initial) {
        setUrl((current) => current ?? initial);
      }
    });
    const subscription = Linking.addEventListener("url", (event) => setUrl(event.url));
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);
  return url;
}
