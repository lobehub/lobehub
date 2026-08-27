import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivatorExecutionRuntime, type ActivatorRuntimeService } from './index';

const NAMESPACE_ENV = 'BUILTIN_TOOL_ID_NAMESPACE';

const createService = (
  overrides: Partial<ActivatorRuntimeService> = {},
): ActivatorRuntimeService => ({
  getActivatedToolIds: vi.fn(() => []),
  getToolManifests: vi.fn(async () => []),
  markActivated: vi.fn(),
  ...overrides,
});

afterEach(() => {
  delete process.env[NAMESPACE_ENV];
});

describe('ActivatorExecutionRuntime.activateTools — white-label wire namespace', () => {
  // Regression for the "I am LobeHub" brand leak: a deployment that sets
  // BUILTIN_TOOL_ID_NAMESPACE must (a) accept the wire-namespaced identifiers
  // the model actually holds (from `<available_tools>`, itself wire-mapped by
  // `buildToolDiscoveryConfig`), resolving them to the canonical `lobe-*`
  // manifest for the actual lookup, and (b) never leak the canonical
  // `lobe-*` string back into the response text the model reads.
  it('resolves a wire-namespaced identifier to its canonical manifest and reports it back namespaced', async () => {
    process.env[NAMESPACE_ENV] = 'ttw';

    const getToolManifests = vi.fn(async () => [
      {
        apiDescriptions: [{ description: 'Search the web', name: 'search' }],
        identifier: 'lobe-web-browsing',
        name: 'Web Browsing',
      },
    ]);
    const markActivated = vi.fn();
    const runtime = new ActivatorExecutionRuntime({
      service: createService({ getToolManifests, markActivated }),
    });

    const result = await runtime.activateTools({
      identifiers: ['ttw-web-browsing'],
      reason: 'user asked to search the web',
    });

    // Looked up (and marked activated) by the canonical registry key.
    expect(getToolManifests).toHaveBeenCalledWith(['lobe-web-browsing']);
    expect(markActivated).toHaveBeenCalledWith(['lobe-web-browsing']);

    // Nothing in the model-facing text carries the canonical `lobe-` prefix.
    expect(result.content).toContain('ttw-web-browsing.search');
    expect(result.content).not.toContain('lobe-web-browsing');
  });

  it('reports already-active and not-found identifiers namespaced too', async () => {
    process.env[NAMESPACE_ENV] = 'ttw';

    const runtime = new ActivatorExecutionRuntime({
      service: createService({
        getActivatedToolIds: vi.fn(() => ['lobe-user-memory']),
        getToolManifests: vi.fn(async () => []),
      }),
    });

    const result = await runtime.activateTools({
      identifiers: ['ttw-user-memory', 'ttw-nonexistent-tool'],
      reason: 'test',
    });

    expect(result.content).toContain('Already active: ttw-user-memory');
    expect(result.content).toContain('Not found: ttw-nonexistent-tool');
    expect(result.content).not.toContain('lobe-');
  });

  it('is a no-op with no namespace configured (upstream/OSS behavior unchanged)', async () => {
    const getToolManifests = vi.fn(async () => [
      {
        apiDescriptions: [],
        identifier: 'lobe-web-browsing',
        name: 'Web Browsing',
      },
    ]);
    const runtime = new ActivatorExecutionRuntime({
      service: createService({ getToolManifests }),
    });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing'],
      reason: 'test',
    });

    expect(getToolManifests).toHaveBeenCalledWith(['lobe-web-browsing']);
    expect(result.content).toContain('lobe-web-browsing');
  });
});
