import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT,
  DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS,
  DOCUMENT_HISTORY_QUERY_LIST_LIMIT,
  DOCUMENT_HISTORY_SOURCE_LIMITS,
  FREE_DOCUMENT_HISTORY_WINDOW_DAYS,
} from './documentHistory';

/** @example Every application and package consumer resolves one complete history policy module. */
describe('documentHistory constants', () => {
  /** @example The package-level module retains the legacy application export contract. */
  it('exports the complete Document History policy', () => {
    /** @example Existing history list consumers keep their bounded query size. */
    expect(DOCUMENT_HISTORY_QUERY_LIST_LIMIT).toBe(50);
    /** @example Existing free-plan history gating keeps its retention window. */
    expect(FREE_DOCUMENT_HISTORY_WINDOW_DAYS).toBe(30);
    /** @example Autosave coalescing retains its ten-minute clock bucket. */
    expect(DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS).toBe(10 * 60 * 1000);
    /** @example Source-specific retention remains available to the canonical history service. */
    expect(DOCUMENT_HISTORY_SOURCE_LIMITS).toEqual({
      autosave: 20,
      llm_call: 5,
      manual: 20,
      restore: 5,
      system: 5,
    });
    /** @example Quick Note autosaves reuse the canonical autosave source limit. */
    expect(DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT).toBe(DOCUMENT_HISTORY_SOURCE_LIMITS.autosave);
  });
});
