import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Spinner, useToast } from "heroui-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { TopicFields } from "@/components/topic-fields";
import { useTopicForm } from "@/hooks/use-topic-form";
import { errorMessage, hasErrorCode } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { CreateTopicForm, EMPTY_TOPIC_FORM, type TopicFormField } from "@/lib/topic-form";
import { orpc } from "@/utils/orpc";

export default function NewTopicScreen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { values, errors, setErrors, setField } = useTopicForm(EMPTY_TOPIC_FORM);
  const create = useMutation(
    orpc.topics.create.mutationOptions({
      onSuccess: async (topic) => {
        await queryClient.invalidateQueries({ queryKey: orpc.topics.key() });
        router.replace({ pathname: "/topic/[topicId]", params: { topicId: topic.id } });
      },
      onError: (error) => {
        if (hasErrorCode(error, "CONFLICT")) {
          setErrors({ name: "Name already taken" });
          return;
        }
        toast.show({ variant: "danger", label: errorMessage(error, "Could not create the topic") });
      },
    }),
  );

  function submit() {
    if (create.isPending) {
      return;
    }
    const parsed = CreateTopicForm.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<TopicFormField>(parsed.error));
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
      <TopicFields
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
          <Button.Label>Create topic</Button.Label>
        )}
      </Button>
    </KeyboardAwareScrollView>
  );
}
