import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

const { authRelations, notifierRelations } = schema;

export const relations = {
  ...defineRelations(schema),
  ...authRelations,
  ...notifierRelations,
  // Both parts define relations on `user`; every relation sets `from`/`to`, so the
  // two relation maps can be merged without re-resolving anything.
  user: {
    ...authRelations.user,
    relations: { ...authRelations.user.relations, ...notifierRelations.user.relations },
  },
};
