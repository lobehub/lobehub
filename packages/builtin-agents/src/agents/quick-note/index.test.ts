import { describe, expect, it } from 'vitest';

import { QUICK_NOTE_ANALYZE, QUICK_NOTE_DIVE, quickNoteAnalyzeProtocol } from '.';

/** @example Quick Note agents expose deliberately different capability surfaces. */
describe('Quick Note built-in agents', () => {
  /** @example Background Analyze cannot delegate or execute domain actions. */
  it('keeps Analyze lightweight and tool-free', () => {
    const runtime =
      typeof QUICK_NOTE_ANALYZE.runtime === 'function'
        ? QUICK_NOTE_ANALYZE.runtime({ plugins: ['unexpected'] })
        : QUICK_NOTE_ANALYZE.runtime;

    /** @example Analyze ignores inherited plugins to remain projection-only. */
    expect(runtime.plugins).toEqual([]);
    /** @example Analyze uses a custom, non-agentic tool mode. */
    expect(runtime.chatConfig).toMatchObject({ enableAgentMode: false, toolMode: 'custom' });
    /** @example Product defaults do not overwrite later user capability edits. */
    expect(QUICK_NOTE_ANALYZE.userConfigurable).toBe(true);
    /** @example The fixed protocol remains available for per-run injection. */
    expect(quickNoteAnalyzeProtocol).toContain('note or its user feedback');
    /** @example Lookup hints expand a named concept into separate domain vocabulary. */
    expect(quickNoteAnalyzeProtocol).toContain('"speech", "audio", "ASR", or "TTS"');
  });

  /** @example A user-triggered Dive retains non-delegating agent tools. */
  it('instructs Dive to investigate directly with the scoped tool surface', () => {
    const runtime =
      typeof QUICK_NOTE_DIVE.runtime === 'function'
        ? QUICK_NOTE_DIVE.runtime({ plugins: [] })
        : QUICK_NOTE_DIVE.runtime;

    /** @example The runtime scope filters delegation from this tool surface. */
    expect(runtime.plugins).toContain('lobe-agent');
    /** @example Dive completes the investigation itself. */
    expect(runtime.systemRole).toContain('Do not delegate to other agents.');
  });
});
