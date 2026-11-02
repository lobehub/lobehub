import { DocumentApiName, PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  QUICK_NOTE_DELEGATE_PRESETS,
  QUICK_NOTE_PRESET_PROPOSAL_KINDS,
  QUICK_NOTE_RESOURCE_TYPES,
  type QuickNoteDelegatePreset,
  type QuickNoteProposalPayload,
  type QuickNoteResourceReference,
} from '@lobechat/types';
import { z } from 'zod';

import { normalizeQuickNoteContextQueries } from './context';
import {
  quickNoteGoalPayloadSchema,
  quickNoteTaskPayloadSchema,
  quickNoteTopicPayloadSchema,
} from './executors/schemas';
import type { QuickNoteActionPlan } from './intent';

const PRESET_OUTPUT_SHAPES: Record<QuickNoteDelegatePreset, string> = {
  discuss:
    '{"title":"short conversation title","openingMessage":"first message to the assistant, in the user\'s voice and language, carrying the note and its comments"}',
  goal: '{"title":"short goal title","requirement":"what done means, as concrete acceptance criteria","problemDescription":"the ask in the user\'s words"}',
  research:
    '{"name":"short task title","instruction":"self-contained research brief: question, scope, sources to compare, and the expected report"}',
  write_document:
    '{"title":"page title","markdown":"the content in Markdown, written from the note","documentId":"only when appending to an existing linked document; omit otherwise"}',
};

const PRESET_GUIDANCE: Record<QuickNoteDelegatePreset, string> = {
  discuss: 'Prepare a conversation the user can open to talk the note through.',
  goal: 'Prepare a Goal the user wants tracked to completion.',
  research: 'Prepare a research Task another agent will run without seeing this conversation.',
  write_document:
    'Write the content now; it is saved as-is, so make it complete. By default it becomes a new Page. When the note asks to add to a Page or document that is a context candidate marked "linked": true, set "documentId" to that candidate\'s id and write only the section to append; the existing title is kept.',
};

/**
 * Builds the preset-aware instructions for the follow-up Agent run.
 *
 * Only the outputs the plan asked for are requested, so one run covers enrich, link, and
 * delegate together.
 */
export const buildQuickNoteGenerationInstructions = (
  baseProtocol: string,
  plan: QuickNoteActionPlan,
): string => {
  const sections = [
    baseProtocol,
    '',
    'This run was planned by an intent judgement. Produce only these outputs:',
    plan.enrich
      ? '- "summary": a concise Markdown overview with useful background. Use web search when the note names an external subject.'
      : '- "summary": one short sentence restating the note; do not research it.',
    '- "tags": at most five short tags.',
    plan.link
      ? '- "contextQueries" and "relatedResources": link existing resources from the supplied candidates.'
      : '- "contextQueries": [] and "relatedResources": [] (linking was not planned).',
  ];

  if (plan.delegate) {
    const { preset } = plan.delegate;
    sections.push(
      `- "delegate": ${PRESET_GUIDANCE[preset]} Use exactly this shape: ${PRESET_OUTPUT_SHAPES[preset]}`,
      '  Write it in the language of the note. Never execute it yourself.',
    );
  } else {
    sections.push('- Do not output "delegate".');
  }

  sections.push(
    '',
    'Images or files attached to the note can be inspected with analyzeMedia when they matter.',
    'Finish by calling submitResult once with {"summary":"…","tags":[],"contextQueries":[],"relatedResources":[{"type":"topic","id":"…"}],"delegate":{…}}. Only that call is recorded.',
  );

  return sections.join('\n');
};

const resourceSchema = z.object({
  id: z.string().trim().min(1),
  selector: z.record(z.string(), z.unknown()).optional().catch(undefined),
  type: z.enum(QUICK_NOTE_RESOURCE_TYPES),
});

const stringList = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())),
  );

const generationOutputSchema = z.object({
  // `annotation` is the pre-summary key; keep reading it until every custom Analyzer migrates.
  annotation: z.string().optional().catch(undefined),
  contextQueries: stringList.default([]),
  delegate: z.unknown().optional(),
  relatedResources: z.array(z.unknown()).catch([]).default([]),
  summary: z.string().optional().catch(undefined),
  tags: stringList.default([]),
});

const pageDelegateSchema = z.object({
  documentId: z.string().trim().min(1).optional().catch(undefined),
  markdown: z.string().trim().min(1).max(50_000),
  title: z.string().trim().min(1).max(200).optional().catch(undefined),
});

/** Bounds on what a delegate draft may target. */
export interface QuickNoteDelegateTargets {
  /**
   * Documents a `write_document` draft may append to: the note's linked Document/Page resources.
   * A draft naming any other id falls back to a new Page.
   */
  writableDocumentIds?: ReadonlySet<string>;
}

/**
 * Converts the model's preset output into the stored Proposal payload.
 *
 * `write_document` is wrapped into the exact `lobe-page-agent` tool call so the executor never
 * interprets free-form model output: `initPage` for a new Page, or `modifyNodes` with the target
 * `documentId` to append to an existing linked Page.
 */
export const toQuickNoteProposalPayload = (
  preset: QuickNoteDelegatePreset,
  value: unknown,
  targets: QuickNoteDelegateTargets = {},
): QuickNoteProposalPayload | undefined => {
  switch (preset) {
    case 'research': {
      const parsed = quickNoteTaskPayloadSchema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    }
    case 'discuss': {
      const parsed = quickNoteTopicPayloadSchema.omit({ agentId: true }).safeParse(value);
      return parsed.success ? parsed.data : undefined;
    }
    case 'goal': {
      const parsed = quickNoteGoalPayloadSchema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    }
    case 'write_document': {
      const parsed = pageDelegateSchema.safeParse(value);
      if (!parsed.success) return undefined;
      const { documentId, markdown, title } = parsed.data;

      if (documentId && targets.writableDocumentIds?.has(documentId)) {
        return {
          apiName: DocumentApiName.modifyNodes,
          arguments: { markdown },
          documentId,
          identifier: PageAgentIdentifier,
          ...(title ? { title } : {}),
        };
      }
      return {
        apiName: DocumentApiName.initPage,
        arguments: { markdown },
        identifier: PageAgentIdentifier,
        ...(title ? { title } : {}),
      };
    }
  }
};

/**
 * Raw tool-call markup some models (DeepSeek) leak into the text answer instead of a structured
 * tool call: DSML blocks (`<｜DSML｜function_calls>…`, with one or more fullwidth bars), legacy
 * `<｜tool▁calls▁begin｜>…<｜tool▁calls▁end｜>` blocks, and `<tool_call>…</tool_call>`.
 */
const TOOL_CALL_BLOCK_PATTERNS = [
  /<[｜|]+\s*DSML\s*[｜|]+\s*function_calls\s*>[\s\S]*?<\/[｜|]+\s*DSML\s*[｜|]+\s*function_calls\s*>/gi,
  /<[｜|]+tool▁calls▁begin[｜|]+>[\s\S]*?<[｜|]+tool▁calls▁end[｜|]+>/g,
  /<tool_call>[\s\S]*?<\/tool_call>/gi,
];
/** Any leftover special-token tag such as `<｜DSML｜invoke name="x">` or `<｜end▁of▁sentence｜>`. */
const SPECIAL_TOKEN_TAG = /<\/?[｜|][^>]*>/g;

/** Tries to read `text` as a JSON object. */
const tryParseObject = (text: string): unknown => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Extracts the JSON object answer from a model reply that may carry fences, prose, or leaked
 * tool-call markup.
 *
 * Before:
 * - `<｜DSML｜function_calls>…</｜DSML｜function_calls>\n```json\n{"summary":"A"}\n```"`
 *
 * After:
 * - `{ summary: "A" }`
 *
 * Returns:
 * - The parsed object, or `undefined` when no JSON object can be found.
 */
export const extractQuickNoteOutputJson = (content: string): unknown => {
  let text = content;
  for (const pattern of TOOL_CALL_BLOCK_PATTERNS) text = text.replace(pattern, ' ');
  text = text.replaceAll(SPECIAL_TOKEN_TAG, ' ').trim();

  const direct = tryParseObject(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (direct) return direct;

  for (const match of text.matchAll(/```(?:json)?([\s\S]*?)```/gi)) {
    const fenced = tryParseObject(match[1].trim());
    if (fenced) return fenced;
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? tryParseObject(text.slice(start, end + 1)) : undefined;
};

/** Validated output of the follow-up Agent run. */
export interface QuickNoteGenerationOutput {
  contextQueries: string[];
  /** The Proposal draft for the planned preset, when the output carried a valid one. */
  delegate?: {
    kind: (typeof QUICK_NOTE_PRESET_PROPOSAL_KINDS)[QuickNoteDelegatePreset];
    payload: QuickNoteProposalPayload;
    preset: QuickNoteDelegatePreset;
  };
  relatedResources: QuickNoteResourceReference[];
  summary: string;
  tags: string[];
}

/**
 * Bounds the follow-up Agent run output against its plan.
 *
 * Before:
 * - `{ summary: "A", tags: ["x"], delegate: { name: "N", instruction: "I" } }` (the
 *   `submitResult` arguments, or JSON read from a text answer)
 *
 * After:
 * - `{ summary: "A", tags: ["x"], delegate: { kind: "task", preset: "research", payload: {...} } }`
 *
 * Expects:
 * - Outputs the plan did not ask for are dropped (no links unless `link`, no draft unless
 *   `delegate`). An invalid delegate draft is dropped rather than failing the summary.
 * - A `write_document` draft only targets an existing document listed in `targets`.
 *
 * Throws:
 * - When the value is not an object or has no summary.
 */
export const projectQuickNoteGenerationOutput = (
  value: unknown,
  plan: Pick<QuickNoteActionPlan, 'delegate' | 'link'> = { link: true },
  targets: QuickNoteDelegateTargets = {},
): QuickNoteGenerationOutput => {
  const parsed = generationOutputSchema.safeParse(value);
  if (!parsed.success) throw new TypeError('Quick Note output must be a JSON object');

  const output = parsed.data;
  const summary = (output.summary ?? output.annotation)?.trim();
  if (!summary) throw new TypeError('Quick Note output requires a non-empty summary');

  const relatedResources = plan.link
    ? output.relatedResources
        .flatMap((candidate) => {
          const resource = resourceSchema.safeParse(candidate);
          if (!resource.success) return [];
          const { id, selector, type } = resource.data;
          return [{ id, ...(selector ? { selector } : {}), type }];
        })
        .filter(
          (resource, index, resources) =>
            resources.findIndex(
              (candidate) => candidate.id === resource.id && candidate.type === resource.type,
            ) === index,
        )
        .slice(0, 5)
    : [];

  const preset = plan.delegate?.preset;
  const payload = preset ? toQuickNoteProposalPayload(preset, output.delegate, targets) : undefined;

  return {
    contextQueries: plan.link ? normalizeQuickNoteContextQueries(output.contextQueries) : [],
    ...(preset && payload
      ? { delegate: { kind: QUICK_NOTE_PRESET_PROPOSAL_KINDS[preset], payload, preset } }
      : {}),
    relatedResources,
    summary,
    tags: output.tags.slice(0, 5),
  };
};

/**
 * Parses a text answer of the follow-up Agent run.
 *
 * Use when:
 * - The run ended without a `submitResult` call but answered in text (custom analyzers or models
 *   that ignore the tool). It saves the forced submit call when the text already holds the JSON.
 *
 * Expects:
 * - Leaked tool-call markup and prose around the JSON are ignored ({@link extractQuickNoteOutputJson}).
 *
 * Throws:
 * - When the content is not a JSON object or has no summary.
 */
export const parseQuickNoteGenerationOutput = (
  content: string,
  plan: Pick<QuickNoteActionPlan, 'delegate' | 'link'> = { link: true },
  targets: QuickNoteDelegateTargets = {},
): QuickNoteGenerationOutput =>
  projectQuickNoteGenerationOutput(extractQuickNoteOutputJson(content), plan, targets);

/**
 * Checks `submitResult` arguments before they are recorded.
 *
 * Use when:
 * - The submit tool runs, so the model can fix a rejected call within the same run.
 *
 * Expects:
 * - The plan is unknown to the tool, so a `delegate` draft only has to fit one of the presets;
 *   completion checks it against the planned preset again.
 *
 * Returns:
 * - `undefined` when the arguments are acceptable, otherwise a message for the model.
 */
export const validateQuickNoteSubmission = (value: unknown): string | undefined => {
  const parsed = generationOutputSchema.safeParse(value);
  if (!parsed.success) return 'The arguments must be a JSON object.';

  const { annotation, delegate, summary } = parsed.data;
  if (!(summary ?? annotation)?.trim()) return '"summary" must be a non-empty Markdown string.';

  if (delegate !== undefined && delegate !== null) {
    const fitsPreset = QUICK_NOTE_DELEGATE_PRESETS.some(
      (preset) => toQuickNoteProposalPayload(preset, delegate) !== undefined,
    );
    if (!fitsPreset) {
      return '"delegate" does not match the shape given in the instructions. Fill every field of that shape with non-empty text, or omit "delegate" when no delegate was requested.';
    }
  }

  return undefined;
};
