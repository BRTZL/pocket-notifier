import type { MyProject } from "@notifier/contract/project";
import { useQuery } from "@tanstack/react-query";
import { Card, ListGroup, Separator, Spinner } from "heroui-native";
import { Fragment } from "react";
import { View } from "react-native";

import { AddMemberForm } from "@/components/add-member-form";
import { MemberMenu } from "@/components/member-menu";
import { ErrorState } from "@/components/query-state";
import { RoleChip } from "@/components/role-chip";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/** Everyone in the project with their role; owners can add, re-role and remove people. */
export function ProjectMembers({ project }: { project: MyProject }) {
  const members = useQuery(orpc.members.list.queryOptions({ input: { projectId: project.id } }));
  const { data: session } = authClient.useSession();
  const myId = session?.user.id;
  const isOwner = project.role === "owner";

  function renderMembers() {
    if (members.isPending) {
      return (
        <View className="items-center py-4">
          <Spinner />
        </View>
      );
    }
    if (members.isError) {
      return (
        <ErrorState
          inline
          error={members.error}
          title="Could not load members"
          onRetry={() => void members.refetch()}
        />
      );
    }
    return (
      <ListGroup variant="transparent">
        {members.data.map((member, index) => {
          const isMe = member.user.id === myId;
          return (
            <Fragment key={member.user.id}>
              {index > 0 ? <Separator /> : null}
              <ListGroup.Item className="px-0">
                <ListGroup.ItemPrefix>
                  <UserAvatar user={member.user} size="sm" />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle numberOfLines={1}>
                    {isMe ? `${member.user.name} (you)` : member.user.name}
                  </ListGroup.ItemTitle>
                  <ListGroup.ItemDescription numberOfLines={1}>
                    {member.user.email}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <View className="flex-row items-center gap-2">
                    <RoleChip role={member.role} />
                    {isOwner && !isMe ? <MemberMenu member={member} /> : null}
                  </View>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </Fragment>
          );
        })}
      </ListGroup>
    );
  }

  return (
    <Card>
      <Card.Body className="gap-3">
        <Card.Title>Members</Card.Title>
        {renderMembers()}
        {isOwner ? (
          <>
            <Separator />
            <AddMemberForm projectId={project.id} />
          </>
        ) : null}
      </Card.Body>
    </Card>
  );
}
