import type { TaskIntentAnalysis } from '@lobechat/types';

/** Answers keyed by the index of the clarification they belong to. */
export type ClarificationAnswers = Record<number, string>;

/**
 * Whether the reading is worth stopping the user for.
 *
 * The composer runs the reader on every submit, so this gate is the whole
 * difference between a helpful confirmation and a tax on every task. It stops
 * only for something the user alone can settle: a question whose answer
 * changes the deliverable, a request that is really a standing goal, or a
 * reading the model itself is not sure of.
 */
export const shouldConfirmIntent = (analysis: TaskIntentAnalysis): boolean =>
  analysis.clarifications.length > 0 || analysis.kind === 'goal' || analysis.confidence !== 'high';

/**
 * The goal flow's rule, applied to tasks: a generated brief may expand on the
 * request but must never replace it, so the user's own words survive verbatim
 * into what the agent reads.
 */
export const preserveOriginalInstruction = (original: string, refined: string): string => {
  const source = original.trim();
  const generated = refined.trim();

  if (!generated || generated === source) return source;
  return generated.includes(source) ? generated : `${source}\n\n${generated}`;
};

/**
 * The questions the user actually answered. An unanswered question is the user
 * declining to narrow the scope, and writing "unanswered" into the brief would
 * read to the agent as a constraint they never stated.
 */
export const answeredClarifications = (
  analysis: TaskIntentAnalysis,
  answers: ClarificationAnswers,
) =>
  analysis.clarifications
    .map((clarification, index) => ({
      answer: answers[index]?.trim() ?? '',
      question: clarification.question,
    }))
    .filter((pair) => pair.answer);

interface LexicalRoot {
  children?: unknown[];
}

const lexicalParagraph = (text: string) => ({
  children: text
    ? [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }]
    : [],
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
  type: 'paragraph',
  version: 1,
});

/**
 * Append plain paragraphs to a serialized Lexical document without touching
 * anything already in it — the only way to extend a draft that carries file or
 * image nodes, which a markdown round-trip would silently drop.
 *
 * Returns `undefined` when there is no document to extend. That is the signal
 * to send no `editorData` at all: the JSON mirror wins over the markdown when
 * a task is rendered, so a mirror that is missing the appended lines is worse
 * than no mirror, which just rebuilds from the markdown.
 */
export const appendParagraphsToEditorJson = (json: unknown, lines: string[]): unknown => {
  if (lines.length === 0) return json;

  const root = (json as { root?: LexicalRoot } | undefined)?.root;
  if (!root || !Array.isArray(root.children)) return undefined;

  return {
    ...(json as object),
    root: { ...root, children: [...root.children, ...lines.map(lexicalParagraph)] },
  };
};

const answersBlock = (pairs: { answer: string; question: string }[], heading: string): string[] => [
  `## ${heading}`,
  ...pairs.map(({ answer, question }) => `- ${question} ${answer}`),
];

/**
 * Fold the answered clarifications into the draft.
 *
 * Only reached when the rewrite could not run: the brief the user gets is then
 * their own text with their own answers under it, and no model prose they
 * never saw.
 *
 * Both fields are extended together: `instruction` is the markdown the agent
 * reads, `editorData` its rich-text mirror, and a mirror that is missing the
 * answers would be what the task page shows.
 *
 * @param heading localized heading for the appended answers block
 */
export const buildConfirmedDraft = ({
  analysis,
  answers,
  editorJson,
  heading,
  instruction,
}: {
  analysis: TaskIntentAnalysis;
  answers: ClarificationAnswers;
  editorJson: unknown;
  heading: string;
  instruction: string;
}): { editorData: unknown; instruction: string } => {
  const pairs = answeredClarifications(analysis, answers);
  if (pairs.length === 0) return { editorData: editorJson, instruction };

  const block = answersBlock(pairs, heading);
  return {
    editorData: appendParagraphsToEditorJson(editorJson, block),
    instruction: `${instruction}\n\n${block.join('\n')}`,
  };
};

/**
 * The requirement seed handed to the goal modal when the user takes the
 * "this is really a goal" exit. Keeps the answers already given so the
 * handoff doesn't ask for them a second time. Markdown only — the goal modal
 * seeds its own editor from text.
 */
export const buildGoalSeed = ({
  analysis,
  answers,
  heading,
  instruction,
}: {
  analysis: TaskIntentAnalysis;
  answers: ClarificationAnswers;
  heading: string;
  instruction: string;
}): { requirement: string; title: string } => {
  const pairs = answeredClarifications(analysis, answers);

  return {
    requirement:
      pairs.length === 0
        ? instruction
        : `${instruction}\n\n${answersBlock(pairs, heading).join('\n')}`,
    title: analysis.title,
  };
};
