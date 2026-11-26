import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

/** How often the board refreshes while it is on screen. */
const BOARD_REFRESH_MS = 30_000;

/** The user's T3 Code threads as the T3 bridge last reported them. */
export function useT3Board() {
  return useQuery(orpc.t3.board.queryOptions({ refetchInterval: BOARD_REFRESH_MS }));
}
