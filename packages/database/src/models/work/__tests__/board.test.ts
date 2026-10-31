// @vitest-environment node
import type { ArtifactBoardManifest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createArtifactBoardId, WorkModel } from '..';
import {
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const manifest: ArtifactBoardManifest = {
  rounds: [
    {
      id: 'direction',
      options: [
        { canvasId: 'cvs_a', canvasVersion: 1, id: 'a', label: 'A' },
        { canvasId: 'cvs_a', canvasVersion: 1, id: 'b', label: 'B', page: 'cards.html' },
      ],
      title: 'Direction',
    },
    {
      id: 'detail',
      options: [{ canvasId: 'cvs_a', canvasVersion: 2, id: 'b1', label: 'B1' }],
      title: 'Detail',
    },
  ],
  title: 'Members',
};

describe('WorkModel · board', () => {
  it('stores the manifest as a version and lists the latest choice as its status', async () => {
    const model = new WorkModel(serverDB, userId);
    const boardId = createArtifactBoardId();
    const work = await model.registerBoard({ boardId, manifest, topicId });

    expect(work).toMatchObject({
      resourceType: 'board',
      status: null,
      title: 'Members',
      type: 'board',
    });
    const found = await model.findBoard(boardId);
    expect(JSON.parse(found!.version.content!)).toEqual(manifest);
    expect(found!.version.metadata).toEqual({ board: { optionCount: 3, roundCount: 2 } });

    await model.chooseBoardOption({
      boardId,
      chosenBy: userId,
      optionId: 'b',
      roundId: 'direction',
    });
    const result = await model.chooseBoardOption({
      boardId,
      chosenBy: userId,
      optionId: 'b1',
      roundId: 'detail',
    });

    expect(
      result.status === 'chosen' &&
        result.choices.map((choice) => [choice.roundId, choice.chosenOptionId]),
    ).toEqual([
      ['direction', 'b'],
      ['detail', 'b1'],
    ]);
    const after = await model.findBoard(boardId);
    expect(after!.current.work.status).toBe('R2 · B1');
    // Picking is not a new manifest version.
    expect(after!.version.version).toBe(1);
  });

  it('keeps choices across a republish while their option survives', async () => {
    const model = new WorkModel(serverDB, userId);
    const boardId = createArtifactBoardId();
    await model.registerBoard({ boardId, manifest });
    await model.chooseBoardOption({
      boardId,
      chosenBy: userId,
      optionId: 'b',
      roundId: 'direction',
    });
    await model.chooseBoardOption({
      boardId,
      chosenBy: userId,
      optionId: 'b1',
      roundId: 'detail',
    });

    const next: ArtifactBoardManifest = { ...manifest, rounds: [manifest.rounds[0]] };
    const work = await model.registerBoard({ boardId, manifest: next });

    expect(work.status).toBe('R1 · B');
    const found = await model.findBoard(boardId);
    expect(found!.version.version).toBe(2);
    expect((await model.findBoard(boardId, 1))!.version.version).toBe(1);

    // The pick is checked against the manifest current at write time.
    expect(
      await model.chooseBoardOption({
        boardId,
        chosenBy: userId,
        optionId: 'b1',
        roundId: 'detail',
      }),
    ).toEqual({ status: 'optionNotFound' });
  });

  it('is not visible to another user', async () => {
    const boardId = createArtifactBoardId();
    await new WorkModel(serverDB, userId).registerBoard({ boardId, manifest });

    const other = new WorkModel(serverDB, userId2);
    expect(await other.findBoard(boardId)).toBeNull();
    expect(
      await other.chooseBoardOption({
        boardId,
        chosenBy: userId2,
        optionId: 'a',
        roundId: 'direction',
      }),
    ).toEqual({ status: 'boardNotFound' });
  });
});
