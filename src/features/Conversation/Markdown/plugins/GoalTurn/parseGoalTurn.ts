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

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
/** Longest open tag read; the server's attributes are ids, dates and one title. */
const MAX_OPEN_TAG = 4096;

interface ScannedElement {
  attrs: string;
  /** Joined CDATA text without the framing newlines; undefined when self-closing. */
  text?: string;
}

/**
 * The open tag at `start` (`raw[start] === '<'`): its name, raw attribute text
 * and where it ends. Quotes are honoured, so a `>` inside an attribute value
 * does not end the tag.
 */
const readOpenTag = (raw: string, start: number) => {
  let i = start + 1;
  while (i < raw.length && /\w/.test(raw[i])) i++;
  const name = raw.slice(start + 1, i);
  if (!name) return;
  // Bounded, and abandoned at a bare `<`, so a run of unclosed tags costs a
  // constant per `<` instead of a scan to the end of the text each.
  const limit = Math.min(raw.length, start + MAX_OPEN_TAG);
  let quoted = false;
  let end = i;
  for (; end < limit; end++) {
    if (raw[end] === '"') quoted = !quoted;
    else if (!quoted && raw[end] === '>') break;
    else if (!quoted && raw[end] === '<') return;
  }
  if (end >= limit) return;
  const selfClosing = raw[end - 1] === '/';
  return { attrs: raw.slice(i, selfClosing ? end - 1 : end), end: end + 1, name, selfClosing };
};

/**
 * Walks the top-level elements in one linear pass: each is self-closing, or has
 * a body made only of CDATA sections followed by its closing tag. Consuming the
 * CDATA as a unit means element names inside user text (or the instruction's
 * prose) are never read as elements, and nothing here can backtrack.
 */
const scanElements = (raw: string, visit: (name: string, element: ScannedElement) => void) => {
  let pos = raw.indexOf('<');
  while (pos !== -1) {
    const tag = readOpenTag(raw, pos);
    if (!tag) {
      pos = raw.indexOf('<', pos + 1);
      continue;
    }
    if (tag.selfClosing) {
      visit(tag.name, { attrs: tag.attrs });
      pos = raw.indexOf('<', tag.end);
      continue;
    }
    const parts: string[] = [];
    let cursor = tag.end;
    while (raw.startsWith(CDATA_OPEN, cursor)) {
      const close = raw.indexOf(CDATA_CLOSE, cursor + CDATA_OPEN.length);
      if (close === -1) break;
      parts.push(raw.slice(cursor + CDATA_OPEN.length, close));
      cursor = close + CDATA_CLOSE.length;
    }
    const closing = `</${tag.name}>`;
    if (parts.length > 0 && raw.startsWith(closing, cursor)) {
      const text = parts.join('').replace(/^\n/, '').replace(/\n$/, '');
      visit(tag.name, { attrs: tag.attrs, text });
      cursor += closing.length;
    }
    pos = raw.indexOf('<', Math.max(cursor, tag.end));
  }
};

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

  scanElements(raw, (name, { attrs: rawAttrs, text }) => {
    const attrs = parseXmlAttributes(rawAttrs);
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
  });

  return result;
};
