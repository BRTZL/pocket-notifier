"use client";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export default function Dashboard() {
  const me = useQuery(orpc.me.get.queryOptions());

  return <p>API: {me.data ? `signed in as ${me.data.email}` : null}</p>;
}
