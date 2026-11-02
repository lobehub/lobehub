import { describe, expect, it } from 'vitest';

import {
  buildQuickNoteTopicCandidates,
  expandQuickNoteContextSearchTerms,
  normalizeQuickNoteContextQueries,
  rankQuickNoteContextCandidates,
} from './context';

/** @example Quick Note context retrieval remains useful without optional search infrastructure. */
describe('Quick Note recent Topic candidates', () => {
  /** @example Recent Message content bootstraps a Topic whose history summary is empty. */
  it('uses recent messages without depending on historySummary', () => {
    const candidates = buildQuickNoteTopicCandidates(
      [
        {
          historySummary: null,
          id: 'tpc_related',
          title: 'Duplex model experiments',
        },
      ],
      [
        {
          content: 'The current dataset is missing natural interruption and turn-taking samples.',
          topicId: 'tpc_related',
        },
      ],
    );

    /** @example The result retains the Topic identity and the bounded Message evidence. */
    expect(candidates).toEqual([
      {
        content: 'The current dataset is missing natural interruption and turn-taking samples.',
        id: 'tpc_related',
        title: 'Duplex model experiments',
        type: 'topic',
      },
    ]);
  });

  /** @example No Topic can contribute more than two unique recent Message snippets. */
  it('bounds and deduplicates message evidence per Topic', () => {
    const candidates = buildQuickNoteTopicCandidates(
      [{ description: 'Voice research', id: 'tpc_related', title: 'Duplex' }],
      [
        { content: 'First observation', topicId: 'tpc_related' },
        { content: 'First observation', topicId: 'tpc_related' },
        { content: 'Second observation', topicId: 'tpc_related' },
        { content: 'Third observation', topicId: 'tpc_related' },
      ],
    );

    /** @example Description plus the first two unique snippets are retained in recent order. */
    expect(candidates[0]?.content).toBe(
      ['Voice research', 'First observation', 'Second observation'].join('\n'),
    );
  });
});

/** @example Agent-authored lookup hints remain small and safe for literal database matching. */
describe('Quick Note context lookup hints', () => {
  /** @example Wildcards, duplicates, blank values, and an unbounded tail do not reach SQL. */
  it('normalizes and bounds lexical lookup terms', () => {
    const queries = normalizeQuickNoteContextQueries([
      ' voice ',
      'audio%',
      'voice',
      '_',
      'speech',
      'ASR',
      'TTS',
      'turn-taking',
      'streaming',
      'latency',
      'extra',
    ]);

    /** @example The provider receives no SQL wildcards and no more than eight distinct terms. */
    expect(queries).toEqual([
      'voice',
      'audio',
      'speech',
      'ASR',
      'TTS',
      'turn-taking',
      'streaming',
      'latency',
    ]);
  });

  /** @example A phrase fallback keeps the phrase and its literal words. */
  it('expands multi-word hints for literal lookup without semantic search', () => {
    /** @example Atomic terms let a Document match one useful word from a short phrase. */
    expect(expandQuickNoteContextSearchTerms(['streaming audio', '连续音频', 'speech'])).toEqual([
      'streaming audio',
      'streaming',
      'audio',
      '连续音频',
      '连续',
      '音频',
      'speech',
    ]);
  });

  /** @example A cross-domain candidate that matches several hints outranks a generic recent item. */
  it('ranks candidates by bounded lexical evidence and deduplicates resource identities', () => {
    const candidates = rankQuickNoteContextCandidates(
      [
        { content: 'A recent unrelated note', id: 'docs_recent', type: 'document' },
        {
          content: 'Research on voice interruption and audio turn-taking',
          id: 'docs_relevant',
          title: 'Realtime speech study',
          type: 'document',
        },
        {
          content: 'Duplicate row from another matching path',
          id: 'docs_relevant',
          type: 'document',
        },
        { id: 'tpc_related', title: 'Voice experiments', type: 'topic' },
      ],
      ['voice', 'audio', 'speech'],
      2,
    );

    /** @example The multi-match Document wins and the duplicate cannot consume the second slot. */
    expect(candidates.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'docs_relevant', type: 'document' },
      { id: 'tpc_related', type: 'topic' },
    ]);
  });
});
