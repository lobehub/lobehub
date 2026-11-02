import { describe, expect, it } from 'vitest';

import { QUICK_NOTE_ANALYZE, quickNoteAnalyzeProtocol } from '.';

/** @example Quick Note agents expose deliberately different capability surfaces. */
describe('Quick Note built-in agents', () => {
  /** @example Background Analyze mounts only web search and media analysis. */
  it('keeps Analyze lightweight with a fixed tool set', () => {
    const runtime =
      typeof QUICK_NOTE_ANALYZE.runtime === 'function'
        ? QUICK_NOTE_ANALYZE.runtime({ plugins: ['unexpected'] })
        : QUICK_NOTE_ANALYZE.runtime;

    /** @example Analyze ignores inherited plugins and mounts web search plus analyzeMedia. */
    expect(runtime.plugins).toEqual(['lobe-web-browsing', 'lobe-agent']);
    /** @example Web search is available by default. */
    expect(runtime.chatConfig).toMatchObject({ searchMode: 'auto' });
    /** @example Analyze uses a custom, non-agentic tool mode. */
    expect(runtime.chatConfig).toMatchObject({ enableAgentMode: false, toolMode: 'custom' });
    /** @example Product defaults do not overwrite later user capability edits. */
    expect(QUICK_NOTE_ANALYZE.userConfigurable).toBe(true);
    /** @example The fixed protocol remains available for per-run injection. */
    expect(quickNoteAnalyzeProtocol).toContain('Never perform the delegated work yourself');
    /** @example Lookup hints expand a named concept into separate domain vocabulary. */
    expect(quickNoteAnalyzeProtocol).toContain('"speech", "audio", "ASR", or "TTS"');
  });
});
