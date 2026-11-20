import { router } from "expo-router";

import { ProjectNav } from "@/components/project-nav";
import { PanePlaceholder } from "@/components/two-pane";
import { usePaneLayout } from "@/hooks/use-pane-layout";
import { useProjectIdParam } from "@/hooks/use-project";

/** A project's threads; on a wide window they are in the left pane and this is empty. */
export default function ProjectScreen() {
  const projectId = useProjectIdParam();
  const { isWide } = usePaneLayout();
  if (isWide) {
    return (
      <PanePlaceholder title="Select a thread">The project thread or a feature.</PanePlaceholder>
    );
  }
  return (
    <ProjectNav
      projectId={projectId}
      onOpenThread={(key, title) => {
        if (projectId) {
          router.push({
            pathname: "/project/[projectId]/conversation/[key]",
            params: { projectId, key, title },
          });
        }
      }}
      onOpenSettings={() => {
        if (projectId) {
          router.push({ pathname: "/project/[projectId]/settings", params: { projectId } });
        }
      }}
    />
  );
}
