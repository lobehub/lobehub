import type { TracingPayload, TracingSummary } from '../types';

const PREVIEW_CHARS = 400;

const formatDate = (timestamp: number): string => {
  const d = new Date(timestamp);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

const truncate = (text: string, limit: number): string =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n… [truncated ${text.length - limit} chars; pass --full to expand]`;

const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export const renderSummaryTable = (summaries: TracingSummary[]): string => {
  if (summaries.length === 0) return 'No tracing records found.';

  const rows = summaries.map((s) => ({
    id: s.tracing_id.slice(0, 12),
    scenario: s.scenario,
    version: s.prompt_version,
    model: s.model ?? '-',
    status: s.success ? (s.validation_failed ? 'validation-fail' : 'ok') : 'error',
    created: formatDate(s.created_at),
  }));

  const widths = {
    id: Math.max(12, ...rows.map((r) => r.id.length)),
    scenario: Math.max(8, ...rows.map((r) => r.scenario.length)),
    version: Math.max(7, ...rows.map((r) => r.version.length)),
    model: Math.max(5, ...rows.map((r) => r.model.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    created: 19,
  };

  const pad = (text: string, width: number): string => text.padEnd(width);
  const header = [
    pad('ID', widths.id),
    pad('SCENARIO', widths.scenario),
    pad('VERSION', widths.version),
    pad('MODEL', widths.model),
    pad('STATUS', widths.status),
    pad('CREATED', widths.created),
  ].join('  ');

  const body = rows.map((r) =>
    [
      pad(r.id, widths.id),
      pad(r.scenario, widths.scenario),
      pad(r.version, widths.version),
      pad(r.model, widths.model),
      pad(r.status, widths.status),
      pad(r.created, widths.created),
    ].join('  '),
  );

  return [header, '-'.repeat(header.length), ...body].join('\n');
};

const section = (title: string, body: string | undefined, limit: number): string[] =>
  body === undefined ? [] : ['', `── ${title} ──`, truncate(body, limit)];

export const renderPayloadDetail = (
  record: TracingPayload,
  options: { full?: boolean },
): string => {
  const limit = options.full ? Number.POSITIVE_INFINITY : PREVIEW_CHARS;

  const header: (string | false | undefined)[] = [
    `# Tracing ${record.tracing_id}`,
    `  scenario:    ${record.scenario}`,
    `  version:     ${record.prompt_version}  (hash: ${record.prompt_hash})`,
    `  created_at:  ${formatDate(record.created_at)}`,
    (record.model_metadata?.model || record.model_metadata?.provider) &&
      `  model:       ${record.model_metadata?.provider ?? '-'} / ${record.model_metadata?.model ?? '-'}`,
    record.validation_failed && `  validation:  FAILED`,
    record.error && `  error:       ${record.error.code ?? '-'}: ${record.error.message ?? '-'}`,
  ];

  const body = [
    ...section('system_prompt', record.system_prompt, limit),
    ...section('input', record.input === undefined ? undefined : stringify(record.input), limit),
    ...section('output', record.output === undefined ? undefined : stringify(record.output), limit),
    ...section('raw_output (validation_failed)', record.raw_output || undefined, limit),
    ...section('schema', record.schema === undefined ? undefined : stringify(record.schema), limit),
  ];

  return [...header.filter((l): l is string => typeof l === 'string'), ...body].join('\n');
};
