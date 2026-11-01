/**
 * Strip the quoted history and signature out of an inbound mail body.
 *
 * Inbound mail is a *thread*: the raw body repeats every previous reply.
 * Feeding that to the agent wastes context and — worse — re-reads the agent's
 * own earlier answer as if the user had just said it again. We cut the body at
 * the first reply-attribution marker the common clients emit, then drop
 * `>`-prefixed blocks and the `-- ` signature.
 *
 * When the whole body is quoting (a bare "thanks!" reply that only kept the
 * history, or a reply sent from a client that quotes first) the stripped text
 * would be empty — an empty user turn is useless, so we fall back to the
 * original body.
 */

/**
 * Attribution markers, one per client idiom.
 *
 * The wildcards between the fixed parts are bounded on purpose. An unbounded
 * `[^\n]*?` on either side of a literal makes the engine backtrack
 * polynomially on a hostile body (one long line repeating the literal), and
 * this runs on attacker-supplied mail. Real attribution lines are a date plus
 * a name plus a verb, comfortably inside the bound.
 */
const ATTRIBUTION_PATTERNS: RegExp[] = [
  // English clients: "On Mon, 1 Jan 2026 at 10:00, Jane <jane@x.com> wrote:"
  /^\s*On\b[^\n]{1,300}wrote:\s*$/im,
  // Outlook / Thunderbird separators
  /^\s*-{2,}[ \t]*Original Message[ \t]*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m,
  /^\s*From:\s*(?:\S.*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/im,
  // Chinese clients
  /^\s*在[^\n]{0,300}?写道[：:]\s*$/m,
  /^\s*在[^\n]{0,300}?wrote:\s*$/im,
  /^\s*(?:发件人|寄件者|发信人)[：:]/m,
  /^\s*-{2,}[ \t]*(?:原始邮件|转发邮件|回复邮件)[ \t]*-{2,}\s*$/m,
  // Apple Mail
  /^\s*Begin forwarded message:\s*$/im,
  /^\s*Am [^\n]{0,300}?schrieb [^\n]{0,300}?:\s*$/im,
  /^\s*El [^\n]{0,300}?escribió:\s*$/im,
];

/**
 * A `From:` line alone is not enough — a plain text body may legitimately
 * start that way. Only treat it as an Outlook header block when the next few
 * lines look like the rest of the header set.
 */
const hasAddressHeaderBlock = (lines: string[]): boolean =>
  lines.some((line, index) => {
    if (!/^\s*From:\s*\S/.test(line)) return false;
    return lines
      .slice(index, index + 4)
      .some((next) => /^\s*(?:Sent|To|Subject|Date|发送时间|收件人|主题)[：:]/.test(next));
  });

const cutAtAttribution = (text: string): string => {
  const lines = text.split('\n');
  if (hasAddressHeaderBlock(lines)) {
    const index = lines.findIndex((line) => /^\s*From:\s*\S/.test(line));
    if (index > 0) return lines.slice(0, index).join('\n');
  }

  for (const pattern of ATTRIBUTION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match || match.index === 0) continue;
    return text.slice(0, match.index);
  }

  return text;
};

const dropQuotedAndSignature = (text: string): string => {
  const lines = text.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    // `-- ` on its own line starts the signature (RFC 3676).
    if (/^--\s*$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }

  return kept.join('\n');
};

// A linear string pass rather than `/[ \t]+\n/` + `/\n{3,}/`: both regexes
// backtrack polynomially on a body full of tabs or newlines, and the body is
// attacker-supplied. The result is unchanged — trailing spaces/tabs are
// dropped per line and a run of blank lines collapses to a single one.
const collapseBlankLines = (text: string) => {
  const kept: string[] = [];
  let blankRun = 0;

  for (const rawLine of text.split('\n')) {
    let end = rawLine.length;
    while (end > 0 && (rawLine[end - 1] === ' ' || rawLine[end - 1] === '\t')) end -= 1;
    const line = rawLine.slice(0, end);

    if (line === '') {
      blankRun += 1;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }

    kept.push(line);
  }

  return kept.join('\n').trim();
};

/** A line that only announces the quoted block, carrying no content itself. */
const isAttributionLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || /^--$/.test(trimmed)) return true;
  return ATTRIBUTION_PATTERNS.some((pattern) => new RegExp(pattern.source, 'i').test(trimmed));
};

export const stripQuotedReply = (body: string): string => {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return '';

  const stripped = collapseBlankLines(dropQuotedAndSignature(cutAtAttribution(trimmed)));

  // Quote-only mail (a bare "thanks!" that kept the whole history, or a client
  // that quotes before writing) leaves nothing but the attribution line. Hand
  // the original body over rather than an empty or attribution-only turn.
  const hasContent = stripped.split('\n').some((line) => !isAttributionLine(line));
  return hasContent ? stripped : trimmed;
};
