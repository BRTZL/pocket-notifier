import type { MyTopic } from "@notifier/contract/topic";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner, useToast } from "heroui-native";

import { TopicFields } from "@/components/topic-fields";
import { useTopicForm } from "@/hooks/use-topic-form";
import { errorMessage } from "@/lib/errors";
import { fieldErrors } from "@/lib/form";
import { type TopicFormField, UpdateTopicForm } from "@/lib/topic-form";
import { orpc } from "@/utils/orpc";

/** Owner-only: display name, description, default priority and retention. */
export function TopicEditForm({ topic }: { topic: MyTopic }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { values, errors, setErrors, setField } = useTopicForm({
    name: topic.name,
    displayName: topic.displayName ?? "",
    description: topic.description ?? "",
    defaultPriority: topic.defaultPriority,
    retentionDays: String(topic.retentionDays),
  });
  const update = useMutation(
    orpc.topics.update.mutationOptions({
      onSuccess: async (updated) => {
        queryClient.setQueryData(orpc.topics.get.queryKey({ input: { id: updated.id } }), updated);
        await queryClient.invalidateQueries({ queryKey: orpc.topics.list.key() });
        toast.show({ variant: "success", label: "Topic saved" });
      },
      onError: (error) => {
        toast.show({ variant: "danger", label: errorMessage(error, "Could not save the topic") });
      },
    }),
  );

  function submit() {
    if (update.isPending) {
      return;
    }
    const parsed = UpdateTopicForm.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<TopicFormField>(parsed.error));
      return;
    }
    update.mutate({ id: topic.id, ...parsed.data });
  }

  return (
    <Card>
      <Card.Body className="gap-4">
        <Card.Title>Topic details</Card.Title>
        <TopicFields
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
