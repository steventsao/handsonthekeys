import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const studioShares = sqliteTable(
  "studio_shares",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull()
  },
  (table) => [
    uniqueIndex("studio_shares_request_id_unique").on(table.requestId),
    index("studio_shares_expires_idx").on(table.expiresAt),
    index("studio_shares_created_idx").on(table.createdAt)
  ]
)
