import type { Feature, FeatureStatus } from "@notifier/contract/feature";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Chip, PressableFeedback, Typography } from "heroui-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ChatAvatar } from "@/components/chat-avatar";
import { Icon } from "@/components/icon";
import { InvalidProjectLink, ProjectUnavailable } from "@/components/project-unavailable";
import { ErrorState, LoadErrorBanner, LoadingState } from "@/components/query-state";
import { HeaderIconButton, StackHeader } from "@/components/screen-header";
import { SectionHeader, SettingsRow } from "@/components/settings-row";
import { ThemedRefreshControl } from "@/components/themed-refresh-control";
import { projectTitle, useProject, useProjectIdParam } from "@/hooks/use-project";
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus";
import { projectGlyph } from "@/lib/chat-avatar";
import { isAccessError } from "@/lib/errors";
import { sortFeatures } from "@/lib/features";
import { relativeTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const STATUS_COLORS = {
  active: "accent",
  done: "success",
  archived: "default",
} as const satisfies Record<FeatureStatus, string>;

function openThread(projectId: string, key: string, title: string) {
  router.push({
    pathname: "/project/[projectId]/conversation/[key]",
    params: { projectId, key, title },
  });
}

function FeatureRow({ projectId, feature }: { projectId: string; feature: Feature }) {
  const activity = feature.lastMessageAt ? relativeTime(feature.lastMessageAt) : null;
  const details = [feature.description, activity].filter(Boolean).join(" · ");
  return (
    <PressableFeedback
      animation={false}
      onPress={() => openThread(projectId, feature.conversationKey, feature.name)}
      className="min-h-[60px] flex-row items-center gap-3.5 px-5 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`${feature.name}, ${feature.status}`}
    >
      <PressableFeedback.Highlight />
      <ChatAvatar
        subject={{ kind: "conversation", id: feature.slug, name: feature.name, iconUrl: null }}
        size={40}
      />
      <View className="min-w-0 flex-1">
        <Typography numberOfLines={1} className="text-[17px] leading-[22px] font-semibold">
          {feature.name}
        </Typography>
        {details ? (
          <Typography numberOfLines={1} className="text-muted text-[14px] leading-[19px]">
            {details}
          </Typography>
        ) : null}
      </View>
      <Chip size="sm" variant="soft" color={STATUS_COLORS[feature.status]}>
        <Chip.Label>{feature.status}</Chip.Label>
      </Chip>
      <Icon name="chevron-right" color="muted" />
    </PressableFeedback>
  );
}

function Features({ projectId }: { projectId: string }) {
  const features = useQuery(orpc.features.list.queryOptions({ input: { projectId } }));
  useRefreshOnFocus(features.refetch);

  if (features.isPending) {
    return <LoadingState />;
  }
  if (features.isError) {
    return (
      <LoadErrorBanner
        title="Could not load features"
        description={features.error.message}
        onRetry={() => void features.refetch()}
      />
    );
  }
  if (features.data.length === 0) {
    return (
      <Typography className="text-muted px-5 py-2 text-[14px] leading-[19px]">
        No features yet. An agent creates one when it starts a workstream, for example
        "improving-performance".
      </Typography>
    );
  }
  return (
    <View>
      {sortFeatures(features.data).map((feature) => (
        <FeatureRow key={feature.id} projectId={projectId} feature={feature} />
      ))}
    </View>
  );
}

function ProjectScreenContent({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  useRefreshOnFocus(project.refetch);

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

  async function refresh() {
    setIsManualRefresh(true);
    try {
      await project.refetch();
    } finally {
      setIsManualRefresh(false);
    }
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
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow pb-6"
        refreshControl={
          <ThemedRefreshControl refreshing={isManualRefresh} onRefresh={() => void refresh()} />
        }
      >
        {description ? (
          <Typography type="body-sm" color="muted" className="px-5 pt-2 pb-1">
            {description}
          </Typography>
        ) : null}
        <SettingsRow
          icon="forum"
          title="Project thread"
          description="Notifications sent to the project without a feature"
          onPress={() => openThread(projectId, `p:${projectId}`, title)}
        />
        <SectionHeader title="Features" />
        <Features projectId={projectId} />
      </ScrollView>
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
