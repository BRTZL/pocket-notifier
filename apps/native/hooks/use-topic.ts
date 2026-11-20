import { TopicId } from "@notifier/contract/topic";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { isAccessError } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The route's `topicId` if it has the contract's topic id shape, else `null`. */
export function useTopicIdParam(): string | null {
  const { topicId = "" } = useLocalSearchParams<{ topicId: string }>();
  const parsed = TopicId.safeParse(topicId);
  return parsed.success ? parsed.data : null;
}

/** One topic as the signed-in user sees it (role, subscription, unread count). */
export function useTopic(topicId: string) {
  return useQuery({
    ...orpc.topics.get.queryOptions({ input: { id: topicId } }),
    // Retrying "not found" or "forbidden" only delays the not-available state.
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 3,
  });
}

/** The topic's display name, falling back to its name. */
export function topicTitle(topic: { name: string; displayName: string | null }): string {
  return topic.displayName ?? topic.name;
}
