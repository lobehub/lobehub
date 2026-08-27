import { afterEach, describe, expect, it, vi } from 'vitest';

const NAMESPACE_ENV = 'BUILTIN_TOOL_ID_NAMESPACE';

afterEach(() => {
  delete process.env[NAMESPACE_ENV];
  vi.resetModules();
});

// Regression for the "I am LobeHub" brand leak: this prompt's live-capability
// check ("is lobe-local-system available in this session?") is hardcoded
// prose, not derived from any manifest `identifier` field.
describe('skills systemPrompt — wire namespace', () => {
  it('keeps the canonical identifier with no namespace configured', async () => {
    const { systemPrompt } = await import('./systemRole');
    expect(systemPrompt).toContain('lobe-local-system');
  });

  it('never mentions the canonical lobe- prefix when a namespace is configured', async () => {
    process.env[NAMESPACE_ENV] = 'ttw';
    const { systemPrompt } = await import('./systemRole');

    expect(systemPrompt).not.toContain('lobe-');
    expect(systemPrompt).toContain('ttw-local-system');
  });
});
