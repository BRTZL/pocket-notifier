import { ProjectId } from "@notifier/contract/project";
import { router, Stack } from "expo-router";

import { ProjectList } from "@/components/project-list";
import { ProjectNav } from "@/components/project-nav";
import { TwoPane } from "@/components/two-pane";
import { useStackScreenOptions } from "@/hooks/use-navigation-theme";
import { usePaneLayout } from "@/hooks/use-pane-layout";
import { openInPane, usePaneRoute } from "@/hooks/use-pane-route";

/** The project list is always the bottom of this stack, also when a deep link opens a project. */
export const unstable_settings = {
  anchor: "index",
};

/**
 * Wide window: the left pane drills from the project list into a project (its thread and
 * features); the right pane is the stack, showing the selected thread, the project's
 * settings or a new project. Which project is open comes from the route, not the stack
 * depth: a link to a thread opens on top of the list alone.
 */
function ProjectsPane() {
  const route = usePaneRoute("(projects)");
  const path = route?.path ?? [];
  if (path[0] !== "project") {
    return (
      <ProjectList
        onSelect={(project) =>
          openInPane(
            { pathname: "/project/[projectId]", params: { projectId: project.id } },
            { isDetailOpen: path.length > 0 },
          )
        }
      />
    );
  }
  const parsed = ProjectId.safeParse(route?.params.projectId);
  const projectId = parsed.success ? parsed.data : null;
  // Anything below `project/[projectId]` (a thread, settings, a message) is in the right pane.
  const isDetailOpen = path.length > 2;
  const selectedKey = path[2] === "conversation" ? (route?.params.key ?? null) : null;
  return (
    <ProjectNav
      projectId={projectId}
      selectedKey={selectedKey}
      onBack={() => router.dismissTo("/(tabs)/(projects)")}
      onOpenThread={(key, title) => {
        if (projectId && key !== selectedKey) {
          openInPane(
            {
              pathname: "/project/[projectId]/conversation/[key]",
              params: { projectId, key, title },
            },
            { isDetailOpen },
          );
        }
      }}
      onOpenSettings={() => {
        if (projectId && path[2] !== "settings") {
          openInPane(
            { pathname: "/project/[projectId]/settings", params: { projectId } },
            { isDetailOpen },
          );
        }
      }}
    />
  );
}

export default function ProjectsLayout() {
  const screenOptions = useStackScreenOptions();
  const { isWide } = usePaneLayout();
  return (
    <TwoPane list={<ProjectsPane />}>
      {/* The right pane swaps threads in place, like a mail app: no slide. */}
      <Stack screenOptions={{ ...screenOptions, animation: isWide ? "none" : "default" }}>
        <Stack.Screen name="index" options={{ title: "Projects", headerShown: false }} />
        <Stack.Screen name="new" options={{ title: "New project" }} />
        <Stack.Screen
          name="project/[projectId]/index"
          options={{ title: "Project", headerShown: false }}
        />
        <Stack.Screen name="project/[projectId]/settings" options={{ title: "Project settings" }} />
        <Stack.Screen name="project/[projectId]/message/[id]" options={{ title: "Message" }} />
        <Stack.Screen
          name="project/[projectId]/conversation/[key]"
          options={{ title: "Conversation", headerShown: false }}
        />
      </Stack>
    </TwoPane>
  );
}
