export interface ParsedUserFeedbackComment {
  content: string;
  id?: string;
  time?: string;
}

const COMMENT_REGEX = /<comment\b(?<attrs>[^>]*)>(?<body>[\S\s]*?)<\/comment>/g;
const ATTR_REGEX = /(\w+)\s*=\s*"([^"]*)"/g;

const parseAttrs = (attrs: string): Record<string, string> => {
  const out: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(attrs)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
};

export const parseUserFeedback = (raw: string): ParsedUserFeedbackComment[] => {
  if (!raw) return [];
  const comments: ParsedUserFeedbackComment[] = [];
  let match: RegExpExecArray | null;
  COMMENT_REGEX.lastIndex = 0;
  while ((match = COMMENT_REGEX.exec(raw)) !== null) {
    const attrs = parseAttrs(match.groups?.attrs ?? '');
    comments.push({
      content: (match.groups?.body ?? '').trim(),
      id: attrs.id,
      time: attrs.time,
    });
  }
  return comments;
};
