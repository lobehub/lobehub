import { parseXmlAttributes } from '../remarkPlugins/createRemarkXmlBlockPlugin';

export type GoalTurnTrigger = 'continuation' | 'first' | 'settled' | 'takeover';

export interface GoalTurnAttributes {
  goal?: string;
  maxTurns?: string;
  trigger?: GoalTurnTrigger | string;
  turn?: string;
  version?: string;
}

export interface GoalTurnFeedback {
  author: string;
  body: string;
  isNew: boolean;
  taskId?: string;
  taskTitle?: string;
  truncated: boolean;
  updatedAt?: string;
}

export interface ParsedGoalTurn {
  continuation?: string;
  feedback: GoalTurnFeedback[];
  instruction?: string;
  omitted: { earlier: number; new: number };
  ownerInstruction?: string;
  previousTurn?: { action?: string; outcome: string; reason?: string };
  problem?: string;
  requirement?: string;
}

/*
 * One top-level element: self-closing, or with a body made only of CDATA
 * sections. Matching the CDATA as a unit means element names that appear inside
 * user text (or in the instruction's prose) are never read as elements.
 */
const ELEMENT_RE =
  /<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*(?:\/>|>((?:<!\[CDATA\[[\S\s]*?\]\]>)+)<\/\1>)/g;

/** The text of every CDATA section in `raw`, joined, without the framing newlines. */
const cdataText = (raw: string) =>
  [...raw.matchAll(/<!\[CDATA\[([\S\s]*?)\]\]>/g)]
    .map((m) => m[1])
    .join('')
    .replace(/^\n/, '')
    .replace(/\n$/, '');

const count = (value: string | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Parses the children of a `<goalTurn>` block emitted by the goal manager
 * prompt. Tolerant by design — anything it does not recognise is ignored, never
 * thrown on, so a malformed block degrades to a sparse card, not a crash.
 */
export const parseGoalTurn = (raw: string): ParsedGoalTurn => {
  const result: ParsedGoalTurn = { feedback: [], omitted: { earlier: 0, new: 0 } };
  if (!raw) return result;

  for (const match of raw.matchAll(ELEMENT_RE)) {
    const [, name, rawAttrs, body] = match;
    const attrs = parseXmlAttributes(rawAttrs ?? '');
    const text = body ? cdataText(body) : undefined;
    switch (name) {
      case 'continuation':
      case 'instruction':
      case 'ownerInstruction':
      case 'problem':
      case 'requirement': {
        result[name] = text;
        break;
      }
      case 'previousTurn': {
        if (attrs.outcome)
          result.previousTurn = { action: attrs.action, outcome: attrs.outcome, reason: text };
        break;
      }
      case 'feedback': {
        result.feedback.push({
          author: attrs.author ?? 'unknown',
          body: text ?? '',
          isNew: attrs.new === 'true',
          taskId: attrs.taskId,
          taskTitle: attrs.taskTitle,
          truncated: attrs.truncated === 'true',
          updatedAt: attrs.updatedAt,
        });
        break;
      }
      case 'omittedFeedback': {
        result.omitted = { earlier: count(attrs.earlier), new: count(attrs.new) };
        break;
      }
    }
  }

  return result;
};
