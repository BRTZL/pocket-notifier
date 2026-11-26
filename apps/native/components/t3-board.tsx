import type { T3BoardThread } from "@notifier/contract/t3";
import { PressableFeedback, Typography } from "heroui-native";
import { View } from "react-native";

import { ChatAvatar } from "@/components/chat-avatar";
import { Icon } from "@/components/icon";
import { T3PhaseChip } from "@/components/t3-phase-chip";
import { useOpenLink } from "@/hooks/use-open-link";
import { useT3Board } from "@/hooks/use-t3-board";
import { chatTime } from "@/lib/format";
import { BRIDGE_OFFLINE_MS } from "@/lib/t3";

function BoardRow({
  thread,
  onOpenConversation,
}: {
  thread: T3BoardThread;
  onOpenConversation: (thread: T3BoardThread) => void;
}) {
  const openLink = useOpenLink();
  const { t3 } = thread;
  const detail = t3.summary ?? t3.branch ?? "";
  return (
    <PressableFeedback
      animation={false}
      // Its chat when an agent or the bridge wrote there; else the thread in T3.
      onPress={() => (thread.hasMessages ? onOpenConversation(thread) : openLink(t3.url))}
      className="flex-row items-center gap-3 px-5 py-2"
      accessibilityRole="button"
      accessibilityLabel={`${thread.name}, ${thread.projectTitle}. ${detail}`}
    >
      <PressableFeedback.Highlight />
      <ChatAvatar
        size={40}
        subject={{
          kind: "conversation",
          id: thread.key.slice(2),
          name: thread.name,
          iconUrl: thread.iconUrl,
        }}
      />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Typography numberOfLines={1} className="flex-1 text-[16px] leading-[21px] font-semibold">
            {thread.name}
            <Typography className="text-muted text-[14px] font-medium">
              {"  ·  "}
              {thread.projectTitle}
            </Typography>
          </Typography>
          {t3.phaseAt ? (
            <Typography className="text-muted text-[13px] leading-[18px]">
              {chatTime(t3.phaseAt)}
            </Typography>
          ) : null}
        </View>
        <View className="mt-1 flex-row items-center gap-2">
          {t3.phase ? <T3PhaseChip phase={t3.phase} /> : null}
          <Typography numberOfLines={1} className="text-muted flex-1 text-[14px] leading-[19px]">
            {detail}
          </Typography>
        </View>
      </View>
    </PressableFeedback>
  );
}

/**
 * The top of the inbox: the user's T3 Code threads that run, wait on them, or ended in
 * the last day, threads needing the user first. Hidden until a T3 bridge has reported.
 */
export function T3BoardSection({
  onOpenConversation,
}: {
  onOpenConversation: (thread: T3BoardThread) => void;
}) {
  const { data } = useT3Board();
  if (!data?.bridgeSeenAt) {
    return null;
  }
  const offline = Date.now() - Date.parse(data.bridgeSeenAt) > BRIDGE_OFFLINE_MS;
  return (
    <View className="pb-2">
      <View className="flex-row items-center gap-2 px-5 pt-1 pb-1.5">
        <Typography className="text-muted flex-1 text-[13px] font-semibold tracking-wide uppercase">
          T3 threads
        </Typography>
        {offline ? (
          <View className="flex-row items-center gap-1">
            <Icon name="cloud-off" size={15} color="muted" />
            <Typography className="text-muted text-[12.5px]">
              Bridge offline since {chatTime(data.bridgeSeenAt)}
            </Typography>
          </View>
        ) : null}
      </View>
      {data.threads.length === 0 ? (
        <Typography className="text-muted px-5 pb-2 text-[14px]">
          Nothing running. Threads show here while they work or wait on you.
        </Typography>
      ) : (
        data.threads.map((thread) => (
          <BoardRow
            key={`${thread.projectId}/${thread.key}`}
            thread={thread}
            onOpenConversation={onOpenConversation}
          />
        ))
      )}
      <View className="bg-separator mx-5 mt-2 h-px" />
    </View>
  );
}
