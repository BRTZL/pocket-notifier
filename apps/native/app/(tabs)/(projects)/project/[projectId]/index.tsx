import { router } from "expo-router";
import { Typography } from "heroui-native";
import { View } from "react-native";
import { MessageList } from "@/components/message-list";
import { InvalidProjectLink, ProjectUnavailable } from "@/components/project-unavailable";
import { EmptyState, ErrorState, LoadingState } from "@/components/query-state";
import { HeaderIconButton, StackHeader } from "@/components/screen-header";
import { projectTitle, useProject, useProjectIdParam } from "@/hooks/use-project";
import { projectGlyph } from "@/lib/chat-avatar";
import { isAccessError } from "@/lib/errors";

function ProjectScreenContent({ projectId }: { projectId: string }) {
  const project = useProject(projectId);

  if (project.isPending || isAccessError(project.error) || (project.isError && !project.data)) {
    return (
      <View className="bg-background flex-1">
        <StackHeader title="Project" />
        {project.isPending ? (
          <LoadingState />
        ) : isAccessError(project.error) ? (
          <ProjectUnavailable />
        ) : (
          <ErrorState error={project.error} onRetry={() => void project.refetch()} />
        )}
      </View>
    );
  }

  const { name, description } = project.data;
  const title = projectTitle(project.data);
  return (
    <View className="bg-background flex-1">
      <StackHeader
        title={title}
        subtitle={title === name ? null : name}
        avatar={{ kind: "glyph", name: title, glyph: projectGlyph(name) }}
        right={
          <HeaderIconButton
            icon="tune"
            label="Project settings"
            onPress={() =>
              router.push({ pathname: "/project/[projectId]/settings", params: { projectId } })
            }
          />
        }
      />
      <MessageList
        projectId={projectId}
        header={
          description ? (
            <Typography type="body-sm" color="muted" className="px-4 pt-2 pb-3">
              {description}
            </Typography>
          ) : undefined
        }
        unavailable={<ProjectUnavailable />}
        empty={
          <EmptyState title="No messages yet" pose="inbox-empty">
            Messages published to {name} show up here.
          </EmptyState>
        }
        onOpenMessage={(message) =>
          router.push({
            pathname: "/project/[projectId]/message/[id]",
            params: { projectId, id: message.id },
          })
        }
      />
    </View>
  );
}

export default function ProjectScreen() {
  const projectId = useProjectIdParam();
  if (!projectId) {
    return (
      <View className="bg-background flex-1">
        <StackHeader title="Project" />
        <InvalidProjectLink />
      </View>
    );
  }
  return <ProjectScreenContent projectId={projectId} />;
}
