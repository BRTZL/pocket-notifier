import type { InboxMessage, MyResponse } from "@notifier/contract/message";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "heroui-native";

import { useInvalidateReadState } from "@/hooks/use-conversations";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The caller's response to one of the message's actions, if they already answered it. */
export function responseTo(message: InboxMessage, actionKey: string): MyResponse | undefined {
  return message.myResponses.find((response) => response.actionKey === actionKey);
}

/**
 * Sends a `reply` action's response. CONFLICT means it was already answered, which
 * counts as done. Either way the lists refetch, so `myResponses` shows the answer.
 */
export function useSendResponse() {
  const { toast } = useToast();
  const invalidate = useInvalidateReadState();
  const mutation = useMutation(orpc.responses.create.mutationOptions());

  /** Resolves `true` once the answer is recorded (now or before), `false` on failure. */
  async function send(input: { messageId: string; actionKey: string; text?: string }) {
    try {
      await mutation.mutateAsync(input);
    } catch (error) {
      if (!hasErrorCode(error, "CONFLICT")) {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not send the reply") });
        return false;
      }
    }
    await invalidate();
    return true;
  }

  return { send, isSending: mutation.isPending };
}
