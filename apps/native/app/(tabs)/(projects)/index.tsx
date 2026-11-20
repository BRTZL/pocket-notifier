import { router } from "expo-router";

import { ProjectList } from "@/components/project-list";
import { PanePlaceholder } from "@/components/two-pane";
import { usePaneLayout } from "@/hooks/use-pane-layout";

/** The project list; on a wide window the list lives in the layout's left pane instead. */
export default function ProjectsScreen() {
  const { isWide } = usePaneLayout();
  if (isWide) {
    return (
      <PanePlaceholder title="Select a project">
        Its threads and features open on the left, a thread here.
      </PanePlaceholder>
    );
  }
  return (
    <ProjectList
      onSelect={(project) =>
        router.push({ pathname: "/project/[projectId]", params: { projectId: project.id } })
      }
    />
  );
}
