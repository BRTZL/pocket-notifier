import type { MyProject } from "@notifier/contract/project";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, cn, PressableFeedback, Typography } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ChatAvatar } from "@/components/chat-avatar";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { HeaderIconButton, ScreenHeader } from "@/components/screen-header";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { projectNameLine } from "@/hooks/use-project";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { projectAvatar } from "@/lib/chat-avatar";
import { orpc } from "@/utils/orpc";

function subscriptionLabel(project: MyProject): string | null {
  if (!project.subscribed) {
    return "Not subscribed";
  }
  return project.muted ? "Muted" : null;
}

function ProjectRow({ project, onPress }: { project: MyProject; onPress: () => void }) {
  const subscription = subscriptionLabel(project);
  const title = project.displayName ?? project.name;
  const unread = project.unreadCount > 0;
  const details = [projectNameLine(project), project.role, subscription]
    .filter(Boolean)
    .join(" · ");
  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      className="flex-row items-center gap-3.5 px-5 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${project.unreadCount} unread${subscription ? `, ${subscription}` : ""}`}
    >
      <PressableFeedback.Highlight />
      <ChatAvatar subject={projectAvatar(project)} />
      <View className="min-w-0 flex-1">
        <Typography
          numberOfLines={1}
          className={cn("text-[17px] leading-[22px]", unread ? "font-heavy" : "font-semibold")}
        >
          {title}
        </Typography>
        <Typography numberOfLines={1} className="text-muted mt-[3px] text-[15px] leading-[21px]">
          {details}
        </Typography>
      </View>
      {unread ? (
        <View
          className={cn(
            "h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px]",
            project.muted || !project.subscribed ? "bg-surface-tertiary" : "bg-accent",
          )}
        >
          <Typography
            className={cn(
              "text-[12.5px] leading-4 font-bold",
              project.muted || !project.subscribed ? "text-muted" : "text-accent-foreground",
            )}
          >
            {project.unreadCount > 99 ? "99+" : String(project.unreadCount)}
          </Typography>
        </View>
      ) : null}
    </PressableFeedback>
  );
}

/** Every project the user is in, with unread counts; "new project" in the header. */
export function ProjectList({ onSelect }: { onSelect: (project: MyProject) => void }) {
  const projects = useQuery(orpc.projects.list.queryOptions());
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(projects.refetch);

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await projects.refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }

  function renderContent() {
    if (projects.isPending) {
      return <LoadingState />;
    }
    if (projects.isError) {
      return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
    }
    if (projects.data.length === 0) {
      return (
        <View className="gap-4 px-5">
          <EmptyState title="No projects yet" pose="projects-empty">
            Projects you create or are invited to show up here.
          </EmptyState>
          <Button className="h-[52px] rounded-full" onPress={() => router.push("/new")}>
            <Button.Label>Create a project</Button.Label>
          </Button>
        </View>
      );
    }
    return (
      <View>
        {projects.data.map((project) => (
          <ProjectRow key={project.id} project={project} onPress={() => onSelect(project)} />
        ))}
      </View>
    );
  }

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title="Projects"
        right={
          <HeaderIconButton icon="add" label="New project" onPress={() => router.push("/new")} />
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow pt-1 pb-6"
        refreshControl={
          <ThemedRefreshControl refreshing={isManualRefresh} onRefresh={() => void refresh()} />
        }
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
}
