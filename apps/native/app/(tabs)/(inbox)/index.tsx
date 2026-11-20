import { router } from "expo-router";
import { Chip } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";

import { MessageList } from "@/components/message-list";
import { EmptyState } from "@/components/query-state";

type Filter = "all" | "unread";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
];

function FilterChips({ value, onChange }: { value: Filter; onChange: (filter: Filter) => void }) {
  return (
    <View className="flex-row gap-2 px-4 pt-2 pb-3" accessibilityRole="tablist">
      {FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Chip
            key={filter.key}
            variant={selected ? "primary" : "secondary"}
            color={selected ? "accent" : "default"}
            onPress={() => onChange(filter.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Chip.Label>{filter.label}</Chip.Label>
          </Chip>
        );
      })}
    </View>
  );
}

export default function InboxScreen() {
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <MessageList
      unreadOnly={filter === "unread"}
      header={<FilterChips value={filter} onChange={setFilter} />}
      empty={
        <EmptyState title="All caught up" pose="inbox-empty">
          {filter === "unread"
            ? "No unread messages."
            : "Nothing here yet. Messages published to your topics show up here."}
        </EmptyState>
      }
      onOpenMessage={(message) =>
        router.push({ pathname: "/message/[id]", params: { id: message.id } })
      }
    />
  );
}
