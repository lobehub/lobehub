import { afterEach, describe, expect, it, vi } from 'vitest';

const NAMESPACE_ENV = 'BUILTIN_TOOL_ID_NAMESPACE';

afterEach(() => {
  delete process.env[NAMESPACE_ENV];
  vi.resetModules();
});

// Regression for the "I am LobeHub" brand leak: unlike the tool identifiers
// handled by ToolNameResolver/buildToolDiscoveryConfig, these `lobe-*`
// mentions are hardcoded instruction prose, not derived from any manifest
// `identifier` field — a deployment could set BUILTIN_TOOL_ID_NAMESPACE and
// still have the model reasoning from this literal text.
describe('activator systemPrompt — wire namespace', () => {
  it('keeps the canonical lobe- identifiers with no namespace configured', async () => {
    const { systemPrompt } = await import('./systemRole');
    expect(systemPrompt).toContain('lobe-skill-store');
    expect(systemPrompt).toContain('lobe-creds');
  });

  it('never mentions the canonical lobe- prefix when a namespace is configured', async () => {
    process.env[NAMESPACE_ENV] = 'ttw';
    const { systemPrompt } = await import('./systemRole');

    expect(systemPrompt).not.toContain('lobe-');
    expect(systemPrompt).toContain('ttw-skill-store');
    expect(systemPrompt).toContain('ttw-creds');
    expect(systemPrompt).toContain('ttw-skills');
    expect(systemPrompt).toContain('ttw-cloud-sandbox');
  });
});
