import { ProjectId } from "@notifier/contract/project";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { isAccessError } from "@/lib/errors";
import { orpc } from "@/utils/orpc";

/** The route's `projectId` if it has the contract's project id shape, else `null`. */
export function useProjectIdParam(): string | null {
  const { projectId = "" } = useLocalSearchParams<{ projectId: string }>();
  const parsed = ProjectId.safeParse(projectId);
  return parsed.success ? parsed.data : null;
}

/** One project as the signed-in user sees it (role, subscription, unread count). */
export function useProject(projectId: string) {
  return useQuery({
    ...orpc.projects.get.queryOptions({ input: { id: projectId } }),
    // Retrying "not found" or "forbidden" only delays the not-available state.
    retry: (failureCount, error) => !isAccessError(error) && failureCount < 3,
  });
}

/** The project's display name, falling back to its name. */
export function projectTitle(project: { name: string; displayName: string | null }): string {
  return project.displayName ?? project.name;
}

/**
 * The line under a project's title: its name when a display name hides it. The personal
 * "General" project has a generated name, so it says "Private" instead.
 */
export function projectNameLine(project: {
  name: string;
  displayName: string | null;
  personal: boolean;
}): string | null {
  if (project.personal) {
    return "Private";
  }
  return project.displayName && project.displayName !== project.name ? project.name : null;
}
