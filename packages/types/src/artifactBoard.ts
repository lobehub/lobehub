import { z } from 'zod';

import type { AcceptanceFrameBoardInput } from './acceptanceFrame';

/**
 * A board is the intent half of the design loop: rounds of candidate designs,
 * each option a page of a Canvas at a pinned version, and the choice made in
 * every round. Its choices then become the candidates an acceptance's frames
 * board locks a baseline from, so the same Canvas data runs end to end.
 *
 * Like an acceptance frame version, an option cannot hold an image: a picture
 * can neither be clicked through nor re-opened at the version it was taken from.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const boardKey = z
  .string()
  .trim()
  .regex(/^[\w-]{1,64}$/, 'Use letters, digits, `_` or `-` (at most 64)');

export const artifactBoardOptionSchema = z
  .object({
    canvasId: text(255),
    /** Pinned, so later edits to the Canvas do not move what was chosen. */
    canvasVersion: z.number().int().positive(),
    /** Author key; the choice of a round records it. */
    id: boardKey,
    /** Short handle shown on the card, e.g. `A`, `B · compact`. */
    label: text(60),
    /** The Canvas page to show, e.g. `members.html`; the Canvas entry when absent. */
    page: z
      .string()
      .trim()
      .regex(/^[\w./-]{1,200}\.html$/i)
      .optional(),
    /** One sentence on why this option is worth picking. */
    reason: z.string().trim().max(300).optional(),
    recommended: z.boolean().optional(),
  })
  // Unknown keys are refused rather than dropped, so `image`, `screenshot` or
  // `url` fails loudly instead of publishing an option that silently lost them.
  .strict();

export const artifactBoardRoundSchema = z
  .object({
    description: z.string().trim().max(1000).optional(),
    id: boardKey,
    options: z.array(artifactBoardOptionSchema).min(1).max(12),
    title: text(120),
  })
  .strict();

export const ARTIFACT_BOARD_MAX_OPTIONS = 60;

export const artifactBoardManifestSchema = z
  .object({
    description: z.string().trim().max(2000).optional(),
    /** The acceptance frame key the choices publish into; the board id when absent. */
    frameKey: boardKey.optional(),
    rounds: z.array(artifactBoardRoundSchema).min(1).max(10),
    title: text(200),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const roundIds = new Set<string>();
    let optionCount = 0;
    manifest.rounds.forEach((round, roundIndex) => {
      if (roundIds.has(round.id))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate round id "${round.id}"`,
          path: ['rounds', roundIndex, 'id'],
        });
      roundIds.add(round.id);

      const optionIds = new Set<string>();
      round.options.forEach((option, optionIndex) => {
        if (optionIds.has(option.id))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate option id "${option.id}" in round "${round.id}"`,
            path: ['rounds', roundIndex, 'options', optionIndex, 'id'],
          });
        optionIds.add(option.id);
      });
      optionCount += round.options.length;
    });
    if (optionCount > ARTIFACT_BOARD_MAX_OPTIONS)
      ctx.addIssue({
        code: 'custom',
        message: `A board holds at most ${ARTIFACT_BOARD_MAX_OPTIONS} options`,
        path: ['rounds'],
      });
  });

export type ArtifactBoardOption = z.infer<typeof artifactBoardOptionSchema>;
export type ArtifactBoardRound = z.infer<typeof artifactBoardRoundSchema>;
export type ArtifactBoardManifest = z.infer<typeof artifactBoardManifestSchema>;

/** The option picked in one round. */
export interface ArtifactBoardChoice {
  chosenAt: string;
  chosenBy: string | null;
  chosenOptionId: string;
  roundId: string;
}

/** Choices live on the Work, not its versions: picking must not mint a new manifest version. */
export interface ArtifactBoardWorkMetadata {
  choices: Record<string, ArtifactBoardChoice>;
}

/** Version metadata a board Work records; the manifest itself is the version `content`. */
export interface ArtifactBoardVersionMetadata {
  optionCount: number;
  roundCount: number;
}

export interface ArtifactBoardView {
  boardId: string;
  /** Only choices that still name an option of this manifest version. */
  choices: ArtifactBoardChoice[];
  createdAt: Date;
  latestVersion: number;
  manifest: ArtifactBoardManifest;
  title: string;
  version: number;
  workId: string;
}

/** Drop choices whose round or option the current manifest no longer has. */
export const resolveArtifactBoardChoices = (
  manifest: ArtifactBoardManifest,
  choices: Record<string, ArtifactBoardChoice> | undefined,
): ArtifactBoardChoice[] =>
  manifest.rounds.flatMap((round) => {
    const choice = choices?.[round.id];
    return choice && round.options.some((option) => option.id === choice.chosenOptionId)
      ? [choice]
      : [];
  });

/**
 * One line for lists and cards, e.g. `R2 · B` — the latest round that has a
 * choice and what was picked there. `null` before anything is picked.
 */
export const summarizeArtifactBoardChoices = (
  manifest: ArtifactBoardManifest,
  choices: ArtifactBoardChoice[],
): { label: string; round: number; roundTitle: string } | null => {
  const byRound = new Map(choices.map((choice) => [choice.roundId, choice]));
  for (let index = manifest.rounds.length - 1; index >= 0; index -= 1) {
    const round = manifest.rounds[index];
    const choice = byRound.get(round.id);
    const option = choice && round.options.find((item) => item.id === choice.chosenOptionId);
    if (option) return { label: option.label, round: index + 1, roundTitle: round.title };
  }
  return null;
};

/**
 * The board's choices as an acceptance frames board definition — the same
 * JSON `lh acceptance frames publish` reads. One frame per board: each round's
 * pick is a candidate version, the latest round's pick listed first as the
 * baseline candidate. Rounds without a pick contribute nothing.
 */
export const artifactBoardToFrameInput = (
  boardId: string,
  manifest: ArtifactBoardManifest,
  choices: ArtifactBoardChoice[],
): AcceptanceFrameBoardInput['frames'][number] | null => {
  const byRound = new Map(choices.map((choice) => [choice.roundId, choice]));
  const versions = manifest.rounds
    .flatMap((round, index) => {
      const choice = byRound.get(round.id);
      const option = choice && round.options.find((item) => item.id === choice.chosenOptionId);
      if (!option) return [];
      return [
        {
          canvasId: option.canvasId,
          canvasVersion: option.canvasVersion,
          label: `R${index + 1} · ${option.label}`.slice(0, 60),
          note:
            [round.title, option.reason].filter(Boolean).join(' — ').slice(0, 1000) || undefined,
          ...(option.page ? { page: option.page } : {}),
        },
      ];
    })
    .reverse()
    // Two rounds can settle on the same Canvas page; it is one candidate, labelled by its latest round.
    .filter(
      (version, index, list) =>
        list.findIndex(
          (other) =>
            other.canvasId === version.canvasId &&
            other.canvasVersion === version.canvasVersion &&
            other.page === version.page,
        ) === index,
    )
    // An acceptance frame holds at most 8 versions; the latest rounds matter most.
    .slice(0, 8);
  if (versions.length === 0) return null;

  return {
    ...(manifest.description ? { description: manifest.description.slice(0, 2000) } : {}),
    key: manifest.frameKey ?? boardId.replaceAll(/[^\w-]/g, '-').slice(0, 64),
    title: manifest.title.slice(0, 120),
    versions,
  };
};
