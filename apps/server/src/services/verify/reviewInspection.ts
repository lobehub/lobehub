/**
 * What the review predictor could NOT look at.
 *
 * The reviewer silently sees less than the check carries: frames past
 * `MAX_VISUALS` are dropped, audio and video are never read, and a text row whose
 * payload could not be resolved simply vanishes. The prompt then asks for
 * affirmative proof and the model answers "the evidence does not show it" — a
 * reject written about artifacts that exist and were withheld from it.
 *
 * Naming the withheld artifacts is what lets the model tell "nobody captured
 * this" from "I was not shown it", which are the same sentence today and call for
 * opposite answers.
 */

/** Media a still frame can carry a judgement about — mirrors the predictor. */
const IMAGE_TYPES = new Set(['gif', 'screenshot']);
const TEXT_TYPES = new Set(['dom_snapshot', 'markdown', 'text', 'transcript']);

export interface WithheldEvidenceInput {
  /** Visual rows actually attached to the request, after the frame cap. */
  attachedVisualIds: Set<string>;
  /** Every evidence row the check carries, in capture order. */
  evidence: { description?: string | null; id: string; type: string }[];
  /** Text rows whose payload reached the prompt. */
  includedTextIds: Set<string>;
  /** Whether this lane reads nonvisual evidence at all. */
  textLaneEnabled: boolean;
}

const label = (row: { description?: string | null; type: string }) => {
  const caption = row.description?.trim();
  return caption ? `${row.type}: ${caption}` : row.type;
};

/**
 * A prompt-ready block listing the artifacts the request withheld, or
 * `undefined` when the reviewer saw everything the check carries.
 *
 * Captions are included because they are the only handle the model has on an
 * artifact it cannot open — "screenshot of unit U208" is enough to recognize that
 * a verdict depends on it.
 */
export const describeWithheldEvidence = (params: WithheldEvidenceInput): string | undefined => {
  const lines: string[] = [];
  const beyondCap = params.evidence.filter(
    (row) => IMAGE_TYPES.has(row.type) && !params.attachedVisualIds.has(row.id),
  );
  if (beyondCap.length > 0)
    lines.push(
      `${beyondCap.length} more frame(s) exist on this check but were not attached (the request carries at most ${params.attachedVisualIds.size} of them): ${beyondCap.map(label).join(' | ')}`,
    );

  const unreadable = params.evidence.filter(
    (row) => !IMAGE_TYPES.has(row.type) && !TEXT_TYPES.has(row.type),
  );
  if (unreadable.length > 0)
    lines.push(
      `${unreadable.length} artifact(s) are in a medium this reviewer cannot open at all: ${unreadable.map(label).join(' | ')}`,
    );

  const textMissing = params.evidence.filter(
    (row) => TEXT_TYPES.has(row.type) && !params.includedTextIds.has(row.id),
  );
  if (textMissing.length > 0)
    lines.push(
      params.textLaneEnabled
        ? `${textMissing.length} text payload(s) could not be resolved and are absent from the evidence below: ${textMissing.map(label).join(' | ')}`
        : `${textMissing.length} nonvisual payload(s) exist but this request reads frames only: ${textMissing.map(label).join(' | ')}`,
    );

  return lines.length > 0 ? lines.join('\n') : undefined;
};
