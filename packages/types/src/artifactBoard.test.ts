import { describe, expect, it } from 'vitest';

import {
  artifactBoardManifestSchema,
  artifactBoardToFrameInput,
  resolveArtifactBoardChoices,
  summarizeArtifactBoardChoices,
} from './artifactBoard';

const manifest = artifactBoardManifestSchema.parse({
  rounds: [
    {
      id: 'direction',
      options: [
        { canvasId: 'cvs_a', canvasVersion: 1, id: 'a', label: 'A', recommended: true },
        { canvasId: 'cvs_a', canvasVersion: 2, id: 'b', label: 'B', page: 'cards.html' },
      ],
      title: 'Direction',
    },
    {
      id: 'detail',
      options: [
        { canvasId: 'cvs_a', canvasVersion: 3, id: 'b1', label: 'B1', reason: 'Fewer clicks' },
        { canvasId: 'cvs_a', canvasVersion: 4, id: 'b2', label: 'B2' },
      ],
      title: 'Detail',
    },
  ],
  title: 'Members',
});

const choice = (roundId: string, chosenOptionId: string) => ({
  chosenAt: '2026-11-01T00:00:00.000Z',
  chosenBy: 'user',
  chosenOptionId,
  roundId,
});

describe('artifactBoardManifestSchema', () => {
  it('refuses image fields on an option', () => {
    const result = artifactBoardManifestSchema.safeParse({
      rounds: [
        {
          id: 'r1',
          options: [
            { canvasId: 'c', canvasVersion: 1, id: 'a', image: 'https://x/y.png', label: 'A' },
          ],
          title: 'R1',
        },
      ],
      title: 'T',
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('image');
  });

  it('refuses an option without a pinned Canvas version', () => {
    const result = artifactBoardManifestSchema.safeParse({
      rounds: [{ id: 'r1', options: [{ canvasId: 'c', id: 'a', label: 'A' }], title: 'R1' }],
      title: 'T',
    });
    expect(result.success).toBe(false);
  });

  it('refuses duplicate round and option ids', () => {
    const option = { canvasId: 'c', canvasVersion: 1, id: 'a', label: 'A' };
    const result = artifactBoardManifestSchema.safeParse({
      rounds: [
        { id: 'r1', options: [option, option], title: 'R1' },
        { id: 'r1', options: [option], title: 'R1 again' },
      ],
      title: 'T',
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Duplicate option id "a" in round "r1"',
      'Duplicate round id "r1"',
    ]);
  });
});

describe('board choices', () => {
  it('drops choices the manifest no longer has', () => {
    expect(
      resolveArtifactBoardChoices(manifest, {
        detail: choice('detail', 'gone'),
        direction: choice('direction', 'b'),
        old: choice('old', 'a'),
      }),
    ).toEqual([choice('direction', 'b')]);
  });

  it('summarizes the latest round with a pick', () => {
    expect(summarizeArtifactBoardChoices(manifest, [])).toBeNull();
    expect(
      summarizeArtifactBoardChoices(manifest, [choice('direction', 'b'), choice('detail', 'b1')]),
    ).toEqual({ label: 'B1', round: 2, roundTitle: 'Detail' });
  });
});

describe('artifactBoardToFrameInput', () => {
  it('turns each round pick into a candidate, latest first', () => {
    expect(
      artifactBoardToFrameInput('board_x1', manifest, [
        choice('direction', 'b'),
        choice('detail', 'b1'),
      ]),
    ).toEqual({
      key: 'board_x1',
      title: 'Members',
      versions: [
        { canvasId: 'cvs_a', canvasVersion: 3, label: 'R2 · B1', note: 'Detail — Fewer clicks' },
        {
          canvasId: 'cvs_a',
          canvasVersion: 2,
          label: 'R1 · B',
          note: 'Direction',
          page: 'cards.html',
        },
      ],
    });
  });

  it('publishes nothing before a pick', () => {
    expect(artifactBoardToFrameInput('board_x1', manifest, [])).toBeNull();
  });
});
