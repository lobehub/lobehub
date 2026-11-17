// @vitest-environment node
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  generationBatches,
  generations,
  generationShares,
  generationTopics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { GenerationShareModel } from '../generationShare';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'generation-share-user';
const otherUserId = 'generation-share-other-user';

const shareModel = new GenerationShareModel(serverDB, userId);
const otherShareModel = new GenerationShareModel(serverDB, otherUserId);

const expectTRPCCode = async (promise: Promise<unknown>, code: TRPCError['code']) => {
  await expect(promise).rejects.toMatchObject({ code });
};

const seedGeneration = async (
  id: string,
  owner: string,
  type: 'image' | 'music' | 'video' = 'image',
) => {
  await serverDB.insert(generationTopics).values({
    id: `${id}-topic`,
    title: `${type} topic`,
    type,
    userId: owner,
  });
  await serverDB.insert(generationBatches).values({
    config: {},
    generationTopicId: `${id}-topic`,
    id: `${id}-batch`,
    model: 'test-model',
    prompt: `a ${type} prompt`,
    provider: 'test-provider',
    userId: owner,
  });
  await serverDB.insert(generations).values({
    asset: { height: 512, thumbnailUrl: 'thumb.png', url: 'image.png', width: 512 },
    generationBatchId: `${id}-batch`,
    id,
    userId: owner,
  });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await seedGeneration('gen-own', userId);
  await seedGeneration('gen-music', userId, 'music');
  await seedGeneration('gen-other', otherUserId);
});

afterEach(async () => {
  await serverDB.delete(generationShares);
  await serverDB.delete(users);
});

describe('GenerationShareModel', () => {
  describe('create', () => {
    it('creates a private share for an own generation by default', async () => {
      const share = await shareModel.create('gen-own');

      expect(share).toMatchObject({ generationId: 'gen-own', userId, visibility: 'private' });
      expect(share!.id).toHaveLength(12);
    });

    it('returns the existing share instead of a second one', async () => {
      const first = await shareModel.create('gen-own', 'link');
      const second = await shareModel.create('gen-own');

      expect(second!.id).toBe(first!.id);
      expect(second!.visibility).toBe('link');
    });

    it("refuses someone else's generation", async () => {
      await expectTRPCCode(shareModel.create('gen-other'), 'NOT_FOUND');
    });

    it('refuses a trashed generation', async () => {
      await serverDB
        .update(generations)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(generations.id, 'gen-own'));

      await expectTRPCCode(shareModel.create('gen-own'), 'NOT_FOUND');
    });
  });

  describe('setVisibility', () => {
    it('creates on first use and updates afterwards, keeping the same link', async () => {
      const created = await shareModel.setVisibility('gen-own', 'link');
      const updated = await shareModel.setVisibility('gen-own', 'private');

      expect(updated!.id).toBe(created!.id);
      expect(updated!.visibility).toBe('private');
    });

    it('applies each racing first-time change instead of reporting the winner', async () => {
      const [on, off] = await Promise.all([
        shareModel.setVisibility('gen-own', 'link'),
        shareModel.setVisibility('gen-own', 'private'),
      ]);

      // Each call returns the value it wrote, on the same single row.
      expect(on!.visibility).toBe('link');
      expect(off!.visibility).toBe('private');
      expect(on!.id).toBe(off!.id);
      expect(await serverDB.select().from(generationShares)).toHaveLength(1);
    });

    it('a later turn-off always sticks after a first-time turn-on', async () => {
      await shareModel.setVisibility('gen-own', 'link');
      await shareModel.setVisibility('gen-own', 'private');

      expect((await shareModel.getByGenerationId('gen-own'))!.visibility).toBe('private');
    });

    it("refuses to publish someone else's generation", async () => {
      await expectTRPCCode(shareModel.setVisibility('gen-other', 'link'), 'NOT_FOUND');
    });

    it("cannot change another user's share", async () => {
      await otherShareModel.create('gen-other', 'link');

      expect(await shareModel.updateVisibility('gen-other', 'private')).toBeNull();
      expect(await otherShareModel.getByGenerationId('gen-other')).toMatchObject({
        visibility: 'link',
      });
    });
  });

  describe('findByShareIdWithAccessCheck', () => {
    it('lets anyone read a link share, with the prompt and type of the generation', async () => {
      const share = await shareModel.create('gen-music', 'link');

      const result = await GenerationShareModel.findByShareIdWithAccessCheck(serverDB, share!.id);

      expect(result).toMatchObject({
        generationId: 'gen-music',
        model: 'test-model',
        ownerId: userId,
        prompt: 'a music prompt',
        topicTitle: 'music topic',
        type: 'music',
      });
    });

    it('keeps a private share to its owner', async () => {
      const share = await shareModel.create('gen-own');

      await expectTRPCCode(
        GenerationShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'FORBIDDEN',
      );
      await expectTRPCCode(
        GenerationShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, otherUserId),
        'FORBIDDEN',
      );
      await expect(
        GenerationShareModel.findByShareIdWithAccessCheck(serverDB, share!.id, userId),
      ).resolves.toMatchObject({ generationId: 'gen-own' });
    });

    it('stops resolving once the generation is trashed', async () => {
      const share = await shareModel.create('gen-own', 'link');
      await serverDB
        .update(generations)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(generations.id, 'gen-own'));

      await expectTRPCCode(
        GenerationShareModel.findByShareIdWithAccessCheck(serverDB, share!.id),
        'NOT_FOUND',
      );
    });

    it('is NOT_FOUND for an unknown link', async () => {
      await expectTRPCCode(
        GenerationShareModel.findByShareIdWithAccessCheck(serverDB, 'missing'),
        'NOT_FOUND',
      );
    });

    it('counts page views', async () => {
      const share = await shareModel.create('gen-own', 'link');
      await GenerationShareModel.incrementPageViewCount(serverDB, share!.id);
      await GenerationShareModel.incrementPageViewCount(serverDB, share!.id);

      expect((await shareModel.getByGenerationId('gen-own'))!.pageViewCount).toBe(2);
    });
  });
});
