import type { TracingPayload, TracingSummary } from '../types';

// ANSI color helpers — keep parity with @lobechat/agent-tracing's viewer.
const dim = (s: string) => `\x1B[2m${s}\x1B[22m`;
const bold = (s: string) => `\x1B[1m${s}\x1B[22m`;
const green = (s: string) => `\x1B[32m${s}\x1B[39m`;
const red = (s: string) => `\x1B[31m${s}\x1B[39m`;
const yellow = (s: string) => `\x1B[33m${s}\x1B[39m`;
const cyan = (s: string) => `\x1B[36m${s}\x1B[39m`;
const magenta = (s: string) => `\x1B[35m${s}\x1B[39m`;

const PREVIEW_CHARS = 120;
const FULL_PREVIEW_CHARS = 4000;

const padEnd = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length);

const formatTime = (timestamp: number): string => {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const previewLine = (text: string, maxLen: number): string => {
  const single = text.replaceAll(/\s+/g, ' ').trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, maxLen - 1)}…`;
};

const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const statusOf = (record: TracingPayload): string => {
  if (record.error) return red('error');
  if (record.validation_failed) return yellow('validation-fail');
  return green('ok');
};

export const renderSummaryTable = (summaries: TracingSummary[]): string => {
  if (summaries.length === 0) return dim('No tracing records found.');

  const rows = summaries.map((s) => ({
    created: formatTime(s.created_at),
    id: s.tracing_id.slice(0, 12),
    model: s.model ?? '-',
    scenario: s.scenario,
    statusRaw: s.success ? (s.validation_failed ? 'validation-fail' : 'ok') : 'error',
    version: s.prompt_version,
  }));

  // Column widths include a 2-space right gutter so the next column never
  // butts up against this one.
  const widths = {
    created: 19,
    id: 14,
    model: Math.max(8, 'MODEL'.length, ...rows.map((r) => r.model.length)) + 2,
    scenario: Math.max(10, 'SCENARIO'.length, ...rows.map((r) => r.scenario.length)) + 2,
    status: Math.max(8, 'STATUS'.length, 'validation-fail'.length) + 2,
    version: Math.max(7, 'VERSION'.length, ...rows.map((r) => r.version.length)) + 2,
  };

  const colorStatus = (status: string): string =>
    status === 'ok' ? green(status) : status === 'error' ? red(status) : yellow(status);

  // Pad first (using raw text length), then colorize — keeps column alignment
  // independent of ANSI escape codes.
  const header =
    bold(padEnd('ID', widths.id)) +
    bold(padEnd('SCENARIO', widths.scenario)) +
    bold(padEnd('VERSION', widths.version)) +
    bold(padEnd('MODEL', widths.model)) +
    bold(padEnd('STATUS', widths.status)) +
    bold('CREATED');

  const padCell = (text: string, width: number): string =>
    ' '.repeat(Math.max(0, width - text.length));

  const body = rows.map(
    (r) =>
      cyan(r.id) +
      padCell(r.id, widths.id) +
      r.scenario +
      padCell(r.scenario, widths.scenario) +
      r.version +
      padCell(r.version, widths.version) +
      magenta(r.model) +
      padCell(r.model, widths.model) +
      colorStatus(r.statusRaw) +
      padCell(r.statusRaw, widths.status) +
      dim(r.created),
  );

  const ruleWidth =
    widths.id + widths.scenario + widths.version + widths.model + widths.status + widths.created;
  return [header, dim('─'.repeat(ruleWidth)), ...body].join('\n');
};

const roleColor = (role: string): ((s: string) => string) => {
  if (role === 'user') return green;
  if (role === 'assistant') return cyan;
  if (role === 'system') return magenta;
  return yellow;
};

const renderInputMessages = (input: unknown, full: boolean): string[] => {
  if (!Array.isArray(input))
    return [`  ${dim(previewLine(stringify(input), full ? FULL_PREVIEW_CHARS : PREVIEW_CHARS))}`];

  const lines: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const msg = (input[i] ?? {}) as { content?: unknown; role?: string };
    const role = msg.role ?? 'unknown';
    const rawContent =
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    const charCount = rawContent.length;
    const charLabel = charCount > 0 ? dim(`  ${charCount} chars`) : '';
    const connector = i === input.length - 1 ? '└─' : '├─';
    lines.push(`  ${dim(connector)} ${dim(`[${i}]`)} ${roleColor(role)(role)}${charLabel}`);
    if (rawContent) {
      const preview = full ? rawContent : previewLine(rawContent, PREVIEW_CHARS);
      lines.push(`     ${dim(preview)}`);
    }
  }
  return lines;
};

const renderOutput = (output: unknown, full: boolean): string => {
  // Inline tiny single-key objects: `{ completion: "怎么样" }` → `completion: "怎么样"`
  if (
    output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    Object.keys(output).length === 1
  ) {
    const [key, value] = Object.entries(output)[0];
    const rendered = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
    if (rendered.length <= PREVIEW_CHARS) return `${cyan(key)}: ${rendered}`;
  }

  const text = stringify(output);
  if (full || text.length <= PREVIEW_CHARS * 2) return text;
  return previewLine(text, PREVIEW_CHARS);
};

export const renderPayloadDetail = (
  record: TracingPayload,
  options: { full?: boolean },
): string => {
  const full = !!options.full;
  const lines: string[] = [];

  // Header — single compact line.
  const modelLabel =
    record.model_metadata?.provider || record.model_metadata?.model
      ? `  ${magenta(`${record.model_metadata?.provider ?? '-'} / ${record.model_metadata?.model ?? '-'}`)}`
      : '';
  lines.push(
    bold('LLM Generation') +
      `  ${cyan(record.tracing_id.slice(0, 12))}` +
      `  scenario:${record.scenario}` +
      `  ${dim(record.prompt_version)}` +
      modelLabel +
      `  ${statusOf(record)}` +
      `  ${dim(formatTime(record.created_at))}`,
  );

  if (record.error) {
    lines.push(`${red('Error:')} ${record.error.code ?? '-'} — ${record.error.message ?? '-'}`);
  }

  // Build sections as a tree. Each section is rendered as `├─ label  meta` then optional indented body.
  type Section = { body?: string[]; label: string; meta?: string };
  const sections: Section[] = [];

  if (record.system_prompt) {
    sections.push({
      body: full ? [`  ${dim(record.system_prompt)}`] : undefined,
      label: 'system_prompt',
      meta: full
        ? dim(`${record.system_prompt.length} chars`)
        : dim(`${record.system_prompt.length} chars  (use --full to expand)`),
    });
  }

  if (record.input !== undefined) {
    const isArr = Array.isArray(record.input);
    const count = isArr ? (record.input as unknown[]).length : 1;
    sections.push({
      body: renderInputMessages(record.input, full),
      label: 'input',
      meta: isArr ? dim(`${count} message${count === 1 ? '' : 's'}`) : undefined,
    });
  }

  if (record.output !== undefined) {
    sections.push({
      body: [`  ${renderOutput(record.output, full)}`],
      label: 'output',
    });
  }

  if (record.raw_output) {
    sections.push({
      body: [`  ${dim(full ? record.raw_output : previewLine(record.raw_output, PREVIEW_CHARS))}`],
      label: 'raw_output',
      meta: yellow('validation_failed'),
    });
  }

  if (record.schema !== undefined) {
    const schemaText = stringify(record.schema);
    sections.push({
      body: full ? [`  ${dim(schemaText)}`] : undefined,
      label: 'schema',
      meta: dim(
        full ? `${schemaText.length} chars` : `${schemaText.length} chars  (use --full to expand)`,
      ),
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const isLast = i === sections.length - 1;
    const connector = isLast ? '└─' : '├─';
    lines.push(`${dim(connector)} ${bold(s.label)}${s.meta ? `  ${s.meta}` : ''}`);
    if (s.body) {
      for (const line of s.body) lines.push(line);
    }
  }

  return lines.join('\n');
};
