import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ProjectDangerZone } from "@/components/project-danger-zone";
import { ProjectEditForm } from "@/components/project-edit-form";
import { ProjectMembers } from "@/components/project-members";
import { ProjectSubscription } from "@/components/project-subscription";
import { InvalidProjectLink, ProjectUnavailable } from "@/components/project-unavailable";
import { ErrorState, LoadingState } from "@/components/query-state";
import { useProject, useProjectIdParam } from "@/hooks/use-project";
import { isAccessError } from "@/lib/errors";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Typography type="body-sm" weight="semibold" color="muted" className="px-1 uppercase">
        {title}
      </Typography>
      {children}
    </View>
  );
}

function ProjectSettingsScreenContent({ projectId }: { projectId: string }) {
  const project = useProject(projectId);

  if (project.isPending) {
    return <LoadingState />;
  }
  if (isAccessError(project.error)) {
    return <ProjectUnavailable />;
  }
  if (project.isError && !project.data) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }

  const isOwner = project.data.role === "owner";
  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Notifications">
        <ProjectSubscription project={project.data} />
      </Section>
      {isOwner ? (
        <Section title="Settings">
          <ProjectEditForm key={project.data.id} project={project.data} />
        </Section>
      ) : null}
      <Section title="People">
        <ProjectMembers project={project.data} />
      </Section>
      <ProjectDangerZone project={project.data} />
    </KeyboardAwareScrollView>
  );
}

export default function ProjectSettingsScreen() {
  const projectId = useProjectIdParam();
  return projectId ? (
    <ProjectSettingsScreenContent projectId={projectId} />
  ) : (
    <InvalidProjectLink />
  );
}
