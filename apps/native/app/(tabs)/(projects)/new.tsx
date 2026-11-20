import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Spinner, useToast } from "heroui-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { ProjectFields } from "@/components/project-fields";
import { useProjectForm } from "@/hooks/use-project-form";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { CreateProjectForm, EMPTY_PROJECT_FORM, type ProjectFormField } from "@/lib/project-form";
import { orpc } from "@/utils/orpc";

export default function NewProjectScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { values, errors, setErrors, setField } = useProjectForm(EMPTY_PROJECT_FORM);
  const create = useMutation(
    orpc.projects.create.mutationOptions({
      onSuccess: async (project) => {
        await queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
        router.replace({ pathname: "/project/[projectId]", params: { projectId: project.id } });
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) {
          setErrors({ name: "Name already taken" });
          return;
        }
        toast.show({
          variant: "danger",
          label: errorMessage(error, "Could not create the project"),
        });
      },
    }),
  );

  function submit() {
    if (create.isPending) {
      return;
    }
    const parsed = CreateProjectForm.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<ProjectFormField>(parsed.error));
      return;
    }
    const { name, displayName, description, defaultPriority, retentionDays } = parsed.data;
    create.mutate({
      name,
      displayName: displayName ?? undefined,
      description: description ?? undefined,
      defaultPriority,
      retentionDays,
    });
  }

  return (
    <KeyboardAwareScrollView
      className="bg-background"
      contentContainerClassName="gap-6 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <ProjectFields
        values={values}
        errors={errors}
        onChange={setField}
        withName
        isDisabled={create.isPending}
      />
      <Button onPress={submit} isDisabled={create.isPending}>
        {create.isPending ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label>Create project</Button.Label>
        )}
      </Button>
    </KeyboardAwareScrollView>
  );
}
