import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { messages } from '../schemas';
import { hasLiveParentTopic } from './topicVisibility';

describe('hasLiveParentTopic', () => {
  it('keeps topic-less rows and requires a live parent for topic-backed rows', () => {
    const built = new PgDialect().sqlToQuery(hasLiveParentTopic(messages.topicId));

    expect(built.sql).toBe(
      '("messages"."topic_id" IS NULL OR EXISTS (SELECT 1 FROM "topics" WHERE "topics"."id" = "messages"."topic_id" AND "topics"."is_deleted" IS NOT TRUE))',
    );
  });
});
