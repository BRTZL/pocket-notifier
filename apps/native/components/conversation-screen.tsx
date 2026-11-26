import {
  ConversationRef,
  type ConversationSummary,
  type OpenAsk,
} from "@notifier/contract/conversation";
import type { InboxMessage } from "@notifier/contract/message";
import { RESPONSE_TEXT_MAX } from "@notifier/contract/response";
import { useLocalSearchParams } from "expo-router";
import { Button, Input, Spinner, Typography } from "heroui-native";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Icon } from "@/components/icon";
import { EmptyState, ErrorState, LoadErrorBanner, LoadingState } from "@/components/query-state";
import { HeaderIconButton, StackHeader } from "@/components/screen-header";
import { DaySeparator, MessageBubble, MyBubble } from "@/components/thread-bubbles";
import { useOpenLink } from "@/hooks/use-open-link";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { useSendResponse } from "@/hooks/use-send-response";
import { useConversationSummary, useMarkConversationRead, useThread } from "@/hooks/use-thread";
import { type ChatAvatarSubject, conversationAvatar } from "@/lib/chat-avatar";
import { errorMessage, isAccessError } from "@/lib/errors";
import { buildThread, type ThreadItem } from "@/lib/thread";

type Params = { projectId?: string; key?: string; title?: string };

/**
 * Header content: the conversation's summary once loaded (title, avatar, last sender),
 * the route's `title` until then. The link is the latest message's only: an older one
 * would open something stale.
 */
function describeThread(
  summary: ConversationSummary | undefined,
  newest: InboxMessage | undefined,
  fallbackTitle?: string,
) {
  if (!summary) {
    return {
      title: fallbackTitle ?? "Conversation",
      subtitle: "",
      avatar: null,
      linkUrl: null,
      t3Url: null,
    };
  }
  const { title, projectTitle, lastMessage } = summary;
  // A project-level thread is titled after its project: repeating the name adds nothing.
  const subtitle = [lastMessage.senderName, projectTitle]
    .filter((part) => part && part !== title)
    .join(" · ");
  return {
    title,
    subtitle,
    avatar: conversationAvatar(summary),
    linkUrl: newest?.clickUrl ?? null,
    t3Url: summary.t3?.url ?? null,
  };
}

function ThreadHeader({
  title,
  subtitle,
  avatar,
  linkUrl,
  t3Url = null,
}: {
  title: string;
  subtitle: string;
  avatar: ChatAvatarSubject | null;
  linkUrl: string | null;
  /** The feature's T3 Code thread: the user replies there. */
  t3Url?: string | null;
}) {
  const openLink = useOpenLink();
  const hasButtons = linkUrl !== null || t3Url !== null;
  return (
    <StackHeader
      title={title}
      subtitle={subtitle}
      avatar={avatar}
      right={
        hasButtons ? (
          <View className="flex-row">
            {t3Url ? (
              <HeaderIconButton
                icon="reply"
                size={22}
                label="Open in T3"
                onPress={() => openLink(t3Url)}
              />
            ) : null}
            {linkUrl ? (
              <HeaderIconButton
                icon="open-in-new"
                size={22}
                label="Open link"
                onPress={() => openLink(linkUrl)}
              />
            ) : null}
          </View>
        ) : null
      }
    />
  );
}

type Drafts = Record<string, string>;

/**
 * "Reply to <sender>" with a round send button; answers the conversation's open ask.
 * Drafts are kept per ask (`messageId:actionKey`): when the open ask changes, a draft
 * stays with the ask it was written for and is never sent to another one, and a
 * finished send only clears its own ask's draft.
 */
function Composer({
  ask,
  drafts,
  setDrafts,
}: {
  ask: OpenAsk;
  drafts: Drafts;
  setDrafts: (update: (drafts: Drafts) => Drafts) => void;
}) {
  const { send, isSending } = useSendResponse();
  const draftKey = `${ask.messageId}:${ask.actionKey}`;
  const text = drafts[draftKey] ?? "";
  const trimmed = text.trim();
  const name = ask.senderName ?? ask.title ?? "the agent";

  async function submit() {
    if (trimmed.length === 0 || isSending) {
      return;
    }
    // Captured now: the open ask may change while the answer is on its way.
    const target = { messageId: ask.messageId, actionKey: ask.actionKey, key: draftKey };
    const result = await send({
      messageId: target.messageId,
      actionKey: target.actionKey,
      text: trimmed,
    });
    if (result === "sent") {
      setDrafts(({ [target.key]: _sent, ...rest }) => rest);
    }
  }

  return (
    <View className="bg-background border-border flex-row items-center gap-2.5 border-t px-4 py-2.5">
      <Input
        variant="secondary"
        value={text}
        onChangeText={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
        placeholder={`Reply to ${name}`}
        maxLength={RESPONSE_TEXT_MAX}
        editable={!isSending}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        accessibilityLabel={`Reply to ${name}`}
        className="bg-surface h-[50px] flex-1 rounded-full px-5 text-[16px]"
      />
      <Button
        isIconOnly
        onPress={() => void submit()}
        isDisabled={trimmed.length === 0 || isSending}
        className="bg-accent size-[50px] rounded-full"
        accessibilityLabel="Send reply"
      >
        {isSending ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Icon name="send" size={22} color="accent-foreground" />
        )}
      </Button>
    </View>
  );
}

/** Shown instead of the composer when no agent is waiting for a written answer. */
function QuietFooter() {
  return (
    <View className="bg-background border-border border-t px-6 py-4">
      <Typography className="text-muted text-center text-[13px] leading-[18px]">
        Nothing to answer here. Replies open when an agent asks.
      </Typography>
    </View>
  );
}

function renderItem({ item }: { item: ThreadItem }) {
  switch (item.type) {
    case "day":
      return <DaySeparator label={item.label} />;
    case "mine":
      return <MyBubble text={item.text} continuesRun={item.continuesRun} />;
    case "message":
      return (
        <MessageBubble
          message={item.message}
          senderLabel={item.senderLabel}
          isRunEnd={item.isRunEnd}
          continuesRun={item.continuesRun}
        />
      );
    default:
      return null;
  }
}

/** Older history failed to load: rows on screen stay, with a retry above them. */
function OlderHistoryFooter({ query }: { query: ReturnType<typeof useThread>["query"] }) {
  if (query.isFetchingNextPage) {
    return (
      <View className="items-center py-4">
        <Spinner />
      </View>
    );
  }
  if (query.isFetchNextPageError) {
    return (
      <LoadErrorBanner
        title="Could not load older messages"
        description={errorMessage(query.error)}
        onRetry={() => void query.fetchNextPage({ cancelRefetch: false })}
      />
    );
  }
  return null;
}

function ThreadMessages({
  query,
  messages,
}: {
  query: ReturnType<typeof useThread>["query"];
  messages: InboxMessage[];
}) {
  if (query.isPending) {
    return <LoadingState />;
  }
  if (query.isError && messages.length === 0) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (messages.length === 0) {
    return (
      <EmptyState title="No messages yet" pose="inbox-empty">
        Notifications sent here show up in this thread.
      </EmptyState>
    );
  }
  return (
    <FlatList
      inverted
      className="bg-surface-secondary flex-1"
      contentContainerClassName="px-4 pt-3.5 pb-2"
      keyboardShouldPersistTaps="handled"
      data={buildThread(messages)}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      onEndReached={() => {
        // No fetch while another runs, and no retry loop after a failed page: its
        // footer has "Try again".
        if (query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) {
          void query.fetchNextPage({ cancelRefetch: false });
        }
      }}
      onEndReachedThreshold={0.4}
      // An inverted list shows its footer at the top, above the oldest message.
      ListFooterComponent={<OlderHistoryFooter query={query} />}
    />
  );
}

/** Gone or no longer ours: nothing of the conversation stays on screen. */
function ThreadUnavailable() {
  return (
    <View className="bg-background flex-1">
      <ThreadHeader title="Conversation" subtitle="" avatar={null} linkUrl={null} />
      <EmptyState title="Conversation not available" pose="error">
        It expired, or you no longer have access to its project.
      </EmptyState>
    </View>
  );
}

function Thread({
  conversation,
  title: titleParam,
}: {
  conversation: ConversationRef;
  title?: string;
}) {
  const { query, messages } = useThread(conversation);
  const summary = useConversationSummary(conversation);
  const [drafts, setDrafts] = useState<Drafts>({});
  // A thread without messages has no summary (NOT_FOUND), while the message list, which
  // checks membership, still succeeds: that is an empty thread, not a missing one.
  const isEmpty = query.isSuccess && messages.length === 0;
  const isUnavailable = isAccessError(query.error) || (isAccessError(summary.error) && !isEmpty);
  useRefreshOnFocus(query.refetch);
  useRefreshOnFocus(summary.refetch);
  // Only once the summary confirmed access; never for a conversation that is gone.
  useMarkConversationRead(conversation, summary.isSuccess && !isUnavailable);

  if (isUnavailable) {
    return <ThreadUnavailable />;
  }
  const header = describeThread(summary.data, messages[0], titleParam);
  const openAsk = summary.data?.openAsk ?? null;
  return (
    <View className="bg-background flex-1">
      <ThreadHeader
        title={header.title}
        subtitle={header.subtitle}
        avatar={header.avatar}
        linkUrl={header.linkUrl}
        t3Url={header.t3Url}
      />
      <KeyboardAvoidingView behavior="padding" className="bg-surface-secondary flex-1">
        <ThreadMessages query={query} messages={messages} />
        {summary.isSuccess && messages.length > 0 ? (
          openAsk ? (
            <Composer ask={openAsk} drafts={drafts} setDrafts={setDrafts} />
          ) : (
            <QuietFooter />
          )
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * A conversation thread: a feature (`c:<slug>`), another conversation, or the project-level
 * thread (`p:<project id>`). Shown from the inbox and from a project's screen, each in its
 * own tab's stack.
 */
export function ConversationScreen() {
  const params = useLocalSearchParams<Params>();
  const parsed = ConversationRef.safeParse({ projectId: params.projectId, key: params.key });
  if (!parsed.success) {
    return (
      <View className="bg-background flex-1">
        <ThreadHeader title="Conversation" subtitle="" avatar={null} linkUrl={null} />
        <EmptyState title="This link is not valid" pose="error">
          It does not point to a conversation.
        </EmptyState>
      </View>
    );
  }
  // Keyed, so moving between conversations never shows the previous one's state.
  return (
    <Thread
      key={`${parsed.data.projectId}/${parsed.data.key}`}
      conversation={parsed.data}
      title={params.title}
    />
  );
}
