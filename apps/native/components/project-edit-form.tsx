import type { MyProject } from "@notifier/contract/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner, useToast } from "heroui-native";

import { ProjectFields } from "@/components/project-fields";
import { useProjectForm } from "@/hooks/use-project-form";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { type ProjectFormField, UpdateProjectForm } from "@/lib/project-form";
import { orpc } from "@/utils/orpc";

/** Owner-only: display name, description, default priority and retention. */
export function ProjectEditForm({ project }: { project: MyProject }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { values, errors, setErrors, setField } = useProjectForm({
    name: project.name,
    displayName: project.displayName ?? "",
    description: project.description ?? "",
    defaultPriority: project.defaultPriority,
    retentionDays: String(project.retentionDays),
  });
  const update = useMutation(
    orpc.projects.update.mutationOptions({
      onSuccess: async () => {
        // Refetch rather than write the response over the cache: it may be older than a
        // subscription change that finished meanwhile.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.projects.get.queryKey({ input: { id: project.id } }),
          }),
          queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() }),
        ]);
        toast.show({ variant: "success", label: "Project saved" });
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not save the project") });
      },
    }),
  );

  function submit() {
    if (update.isPending) {
      return;
    }
    const parsed = UpdateProjectForm.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<ProjectFormField>(parsed.error));
      return;
    }
    update.mutate({ id: project.id, ...parsed.data });
  }

  return (
    <Card>
      <Card.Body className="gap-4">
        <Card.Title>Project details</Card.Title>
        <ProjectFields
          values={values}
          errors={errors}
          onChange={setField}
          withName={false}
          isDisabled={update.isPending}
        />
        <Button onPress={submit} isDisabled={update.isPending}>
          {update.isPending ? (
            <Spinner size="sm" color="default" />
          ) : (
            <Button.Label>Save changes</Button.Label>
          )}
        </Button>
      </Card.Body>
    </Card>
  );
}
