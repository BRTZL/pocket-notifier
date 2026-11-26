import { authed } from "../base";
import { t3Board } from "../lib/t3-board";

const board = authed.t3.board.handler(({ context }) =>
  t3Board(context.db, context.session.user.id),
);

export const t3Router = authed.t3.router({ board });
