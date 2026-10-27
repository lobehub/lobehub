import { beforeEach, describe, expect, it } from 'vitest';

import { documents } from '../../../schemas';
import { messages } from '../../../schemas/message';
import { topics } from '../../../schemas/topic';
import { users } from '../../../schemas/user';
import type { LobeChatDatabase } from '../../../type';
import type { FtsSearchRepo } from '../index';
import type { FtsSearchTimeRange } from '../types';

const userId = 'time-range-search-user';

const day = (offset: number) => new Date(Date.UTC(2026, 9, 1 + offset));

/** Oct 12 – Oct 18, 2026. */
const window = (field: FtsSearchTimeRange['field']): FtsSearchTimeRange => ({
  end: day(17),
  field,
  start: day(11),
});

export interface FtsSearchTimeRangeBehaviorOptions {
  createRepo: (db: LobeChatDatabase, userId: string) => FtsSearchRepo;
  db: LobeChatDatabase;
  /** Whether the provider answers candidate-only requests. */
  supportsCandidates: boolean;
}

/**
 * Provider-neutral time-window behaviour. Every case seeds a stronger match
 * outside the window and asks for a one-row pool, so a provider that filters
 * after cutting the ranked pool returns nothing instead of the in-window row.
 */
export const describeFtsSearchTimeRangeBehavior = ({
  createRepo,
  db,
  supportsCandidates,
}: FtsSearchTimeRangeBehaviorOptions) => {
  describe('search - time range', () => {
    let repo: FtsSearchRepo;

    beforeEach(async () => {
      await db.delete(users);
      await db.insert(users).values({ id: userId });
      repo = createRepo(db, userId);
    });

    it('keeps topics updated inside the window ahead of stronger stale matches', async () => {
      await db.insert(topics).values([
        {
          content: 'kestrel kestrel kestrel',
          createdAt: day(0),
          id: 'tr-topic-stale',
          title: 'Kestrel',
          updatedAt: day(1),
          userId,
        },
        {
          createdAt: day(2),
          id: 'tr-topic-active',
          title: 'Weekly notes on the kestrel rollout',
          updatedAt: day(14),
          userId,
        },
        {
          createdAt: day(19),
          id: 'tr-topic-future',
          title: 'Kestrel follow-up',
          updatedAt: day(20),
          userId,
        },
      ]);

      const results = await repo.search({
        limitPerType: 1,
        query: 'kestrel',
        timeRange: window('updatedAt'),
        type: 'topic',
      });

      expect(results.map(({ id }) => id)).toEqual(['tr-topic-active']);
    });

    it('keeps pages updated inside the window', async () => {
      const page = (id: string, title: string, updatedAt: Date) => ({
        content: title,
        createdAt: day(0),
        fileType: 'custom/document',
        filename: `${id}.md`,
        id,
        source: `internal://${id}`,
        sourceType: 'file' as const,
        title,
        totalCharCount: title.length,
        totalLineCount: 1,
        updatedAt,
        userId,
      });
      await db
        .insert(documents)
        .values([
          page('tr-page-stale', 'Kestrel', day(1)),
          page('tr-page-active', 'Notes about the kestrel mode', day(15)),
        ]);

      const results = await repo.search({
        limitPerType: 1,
        query: 'kestrel',
        timeRange: window('updatedAt'),
        type: 'page',
      });

      expect(results.map(({ id }) => id)).toEqual(['tr-page-active']);
    });

    it('keeps messages created inside the window', async () => {
      await db.insert(messages).values([
        // Newer and stronger, but after the window: recency ordering alone would pick it.
        {
          content: 'kestrel kestrel',
          createdAt: day(20),
          id: 'tr-msg-later',
          role: 'user',
          userId,
        },
        {
          content: 'we turned on the kestrel mode',
          createdAt: day(13),
          id: 'tr-msg-active',
          role: 'user',
          userId,
        },
      ]);

      const results = await repo.search({
        limitPerType: 1,
        query: 'kestrel',
        timeRange: window('createdAt'),
        type: 'message',
      });

      expect(results.map(({ id }) => id)).toEqual(['tr-msg-active']);
    });

    it.runIf(supportsCandidates)(
      'narrows bounded message candidates before the pool is cut',
      async () => {
        await db.insert(messages).values([
          {
            content: 'kestrel kestrel',
            createdAt: day(1),
            id: 'tr-cand-stale',
            role: 'user',
            userId,
          },
          {
            content: 'kestrel mode notes',
            createdAt: day(13),
            id: 'tr-cand-active',
            role: 'user',
            userId,
          },
        ]);

        const response = await repo.ftsSearchCandidates({
          entity: 'messages',
          filters: { timeRange: window('createdAt') },
          pagination: { limit: 1 },
          query: { fields: ['content'], text: 'kestrel' },
        });

        expect(response.candidates.map(({ id }) => id)).toEqual(['tr-cand-active']);
      },
    );
  });
};
