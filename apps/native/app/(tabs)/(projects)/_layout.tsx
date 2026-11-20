import { Stack } from "expo-router";

import { useStackScreenOptions } from "@/hooks/use-navigation-theme";

/** The project list is always the bottom of this stack, also when a deep link opens a project. */
export const unstable_settings = {
  anchor: "index",
};

export default function ProjectsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
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
  );
}
