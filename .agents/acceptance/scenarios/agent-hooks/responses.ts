export interface ResponseFixture {
  body: string;
  delayMs?: number;
  status?: number;
}

const output = (fields: Record<string, unknown>) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'beforeToolCall', ...fields },
  });

const sizedResponse = (bytes: number) => {
  const fields = { permissionDecision: 'allow', permissionDecisionReason: '' };
  const overhead = Buffer.byteLength(output(fields));
  return output({ ...fields, permissionDecisionReason: 'x'.repeat(bytes - overhead) });
};

export const fixtures: Record<string, ResponseFixture> = {
  'allow': { body: output({ permissionDecision: 'allow' }) },
  'deny': {
    body: output({ permissionDecision: 'deny', permissionDecisionReason: 'D synthetic denial' }),
  },
  'empty': { body: '', status: 204 },
  'observe': { body: '{}' },
  'rewrite': {
    body: output({ permissionDecision: 'allow', updatedInput: { path: 'fixture/effective.txt' } }),
  },
  'context': { body: output({ additionalContext: 'D_CONTEXT_MARKER_20260928' }) },
  'late-allow': { body: output({ permissionDecision: 'allow' }), delayMs: 1200 },
  'malformed': { body: '{broken' },
  'http-error': { body: '{}', status: 503 },
  'unsupported': { body: output({ permissionDecision: 'ask' }) },
  'size-boundary': { body: sizedResponse(65536) },
  'oversized': { body: sizedResponse(65537) },
  'context-boundary': { body: output({ additionalContext: 'x'.repeat(10000) }) },
  'context-overflow': { body: output({ additionalContext: 'x'.repeat(10001) }) },
};
