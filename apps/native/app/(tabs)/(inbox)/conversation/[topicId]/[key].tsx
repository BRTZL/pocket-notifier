import { ConversationRef } from "@notifier/contract/conversation";
import type { InboxMessage } from "@notifier/contract/message";
import { RESPONSE_TEXT_MAX } from "@notifier/contract/response";
import { useLocalSearchParams } from "expo-router";
import { Button, Input, Spinner, Typography } from "heroui-native";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Icon } from "@/components/icon";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { HeaderIconButton, StackHeader } from "@/components/screen-header";
import { DaySeparator, MessageBubble, MyBubble } from "@/components/thread-bubbles";
import { useOpenLink } from "@/hooks/use-open-link";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { useSendResponse } from "@/hooks/use-send-response";
import { useMarkConversationRead, useThread } from "@/hooks/use-thread";
import { type ChatAvatarSubject, topicGlyph } from "@/lib/chat-avatar";
import { isAccessError } from "@/lib/errors";
import { buildThread, type ComposerTarget, composerTarget, type ThreadItem } from "@/lib/thread";

type Params = { topicId?: string; key?: string; title?: string };

/** Title, avatar and subtitle from the loaded messages; the route's `title` until they load. */
function describeThread(ref: ConversationRef, messages: InboxMessage[], fallbackTitle?: string) {
  const newest = messages[0];
  const conversation = messages.find((message) => message.conversation)?.conversation ?? null;
  const topic = newest?.topic ?? "";
  const isTopicFeed = ref.key.startsWith("t:");
  const title =
    (isTopicFeed ? fallbackTitle : (conversation?.title ?? conversation?.id ?? fallbackTitle)) ??
    topic;
  const lastSender = messages.find((message) => message.sender)?.sender ?? null;
  // A topic feed is titled after its topic: repeating the name adds nothing.
  const subtitle = [lastSender ? (lastSender.name ?? lastSender.id) : null, topic]
    .filter((part) => part && part !== title)
    .join(" · ");
  const avatar: ChatAvatarSubject = isTopicFeed
    ? { kind: "glyph", name: title, glyph: topicGlyph(topic) }
    : {
        kind: "conversation",
        // The conversation id, as the inbox row and the web dashboard seed the color.
        id: ref.key.slice(2),
        name: title,
        iconUrl: conversation?.iconUrl ?? null,
      };
  // The latest message's link only: an older one would open something stale.
  const linkUrl = newest?.clickUrl ?? null;
  return { title, subtitle, avatar, linkUrl };
}

function ThreadHeader({
  title,
  subtitle,
  avatar,
  linkUrl,
}: {
  title: string;
  subtitle: string;
  avatar: ChatAvatarSubject | null;
  linkUrl: string | null;
}) {
  const openLink = useOpenLink();
  return (
    <StackHeader
      title={title}
      subtitle={subtitle}
      avatar={avatar}
      right={
        linkUrl ? (
          <HeaderIconButton
            icon="open-in-new"
            size={22}
            label="Open link"
            onPress={() => openLink(linkUrl)}
          />
        ) : null
      }
    />
  );
}

/** "Reply to <sender>" with a round send button; answers the newest open text reply. */
function Composer({ target }: { target: ComposerTarget }) {
  const { send, isSending } = useSendResponse();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  async function submit() {
    if (trimmed.length === 0 || isSending) {
      return;
    }
    const sent = await send({
      messageId: target.message.id,
      actionKey: target.action.key,
      text: trimmed,
    });
    if (sent) {
      setText("");
    }
  }

  return (
    <View className="bg-background border-border flex-row items-center gap-2.5 border-t px-4 py-2.5">
      <Input
        variant="secondary"
        value={text}
        onChangeText={setText}
        placeholder={target.action.placeholder ?? `Reply to ${target.senderName}`}
        maxLength={RESPONSE_TEXT_MAX}
        editable={!isSending}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        accessibilityLabel={`Reply to ${target.senderName}`}
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

function Thread({
  conversation,
  title: titleParam,
}: {
  conversation: ConversationRef;
  title?: string;
}) {
  const { query, messages } = useThread(conversation);
  useRefreshOnFocus(query.refetch);
  useMarkConversationRead(
    conversation,
    messages.some((message) => !message.read),
  );
  const header = describeThread(conversation, messages, titleParam);
  const target = composerTarget(messages);

  function renderBody() {
    if (isAccessError(query.error)) {
      return (
        <EmptyState title="Conversation not available" pose="error">
          It expired, or you no longer have access to its topic.
        </EmptyState>
      );
    }
    if (query.isPending) {
      return <LoadingState />;
    }
    if (query.isError && messages.length === 0) {
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    if (messages.length === 0) {
      return (
        <EmptyState title="No messages" pose="inbox-empty">
          Every message here has expired.
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
          if (query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) {
            void query.fetchNextPage({ cancelRefetch: false });
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="items-center py-4">
              <Spinner />
            </View>
          ) : null
        }
      />
    );
  }

  const isLoaded = messages.length > 0;
  return (
    <View className="bg-background flex-1">
      <ThreadHeader
        title={header.title}
        subtitle={header.subtitle}
        avatar={isLoaded || titleParam ? header.avatar : null}
        linkUrl={header.linkUrl}
      />
      <KeyboardAvoidingView behavior="padding" className="bg-surface-secondary flex-1">
        {renderBody()}
        {isLoaded ? target ? <Composer target={target} /> : <QuietFooter /> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<Params>();
  const parsed = ConversationRef.safeParse({ topicId: params.topicId, key: params.key });
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
      key={`${parsed.data.topicId}/${parsed.data.key}`}
      conversation={parsed.data}
      title={params.title}
    />
  );
}
