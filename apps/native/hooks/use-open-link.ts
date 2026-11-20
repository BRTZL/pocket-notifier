import { useToast } from "heroui-native";

import { errorMessage } from "@/lib/errors";
import { openUrl, UnopenableLinkError } from "@/lib/open-url";

/** Opens a message link, with a toast when it is refused or fails. */
export function useOpenLink() {
  const { toast } = useToast();
  return (url: string) => {
    openUrl(url).catch((error: unknown) => {
      toast.show({
        variant: "danger",
        label:
          error instanceof UnopenableLinkError
            ? error.message
            : errorMessage(error, "Could not open the link"),
      });
    });
  };
}
