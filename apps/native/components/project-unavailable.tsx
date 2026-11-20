import { EmptyState } from "@/components/query-state";

/** The project is gone, or the signed-in user is no longer a member. */
export function ProjectUnavailable() {
  return (
    <EmptyState title="Project not available" pose="error">
      It was deleted, or you are no longer a member.
    </EmptyState>
  );
}

/** The link's project id is malformed: nothing to load. */
export function InvalidProjectLink() {
  return (
    <EmptyState title="Invalid link" pose="error">
      This link does not point to a project.
    </EmptyState>
  );
}
