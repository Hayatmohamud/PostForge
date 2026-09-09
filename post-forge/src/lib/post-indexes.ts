import "server-only";
import type { Db, IndexDescription } from "mongodb";

export const POSTS_COLLECTION = "posts";

/** Never drop/rebuild existing indexes automatically; conflicting data fails closed. */
export async function ensurePostIndexes(db: Db): Promise<void> {
  const indexes: IndexDescription[] = [
    { key: { submissionKey: 1 }, name: "posts_submission_unique", unique: true },
    { key: { eventId: 1 }, name: "posts_event_unique", unique: true },
    { key: { createdAt: -1, _id: -1 }, name: "posts_latest" },
  ];
  await db.collection(POSTS_COLLECTION).createIndexes(indexes);
}
