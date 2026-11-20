import { EmptyState } from "@/components/query-state";

/** The topic is gone, or the signed-in user is no longer a member. */
export function TopicUnavailable() {
  return (
    <EmptyState title="Topic not available" pose="error">
      It was deleted, or you are no longer a member.
    </EmptyState>
  );
}

/** The link's topic id is malformed: nothing to load. */
export function InvalidTopicLink() {
  return (
    <EmptyState title="Invalid link" pose="error">
      This link does not point to a topic.
    </EmptyState>
  );
}
