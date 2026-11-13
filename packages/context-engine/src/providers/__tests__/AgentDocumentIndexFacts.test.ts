import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import type { AgentContextDocument, AgentDocumentIndexFacts } from '../AgentDocumentInjector';
import {
  AgentDocumentContextInjector,
  freezeAgentDocumentIndexFacts,
} from '../AgentDocumentInjector';

const REPORT_ID = '2af6eb88-8bdb-468f-887f-620baa394efa';
const OLDER_ID = '32e12975-7db2-4818-8415-9b5c3d383f05';

const progressiveDoc = (doc: Partial<AgentContextDocument> & { id: string }) =>
  ({
    filename: `${doc.id}.md`,
    loadPosition: 'before-first-user',
    loadRules: { rule: 'always' },
    policyLoad: 'progressive',
    sourceType: 'agent',
    ...doc,
  }) as AgentContextDocument;

/** The documents as the run's first step saw them. */
const beforeEdit = (): AgentContextDocument[] => [
  progressiveDoc({
    contentCharCount: 13_200,
    id: OLDER_ID,
    title: 'Weekly notes',
    updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  }),
  progressiveDoc({
    contentCharCount: 9_400,
    id: REPORT_ID,
    title: 'Draft report',
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  }),
];

/** The same documents after the agent's `modifyNodes` grew and touched the report. */
const afterEdit = (): AgentContextDocument[] => [
  beforeEdit()[0],
  progressiveDoc({
    contentCharCount: 14_100,
    id: REPORT_ID,
    title: 'Draft report',
    updatedAt: new Date('2026-11-13T00:10:50.000Z'),
  }),
];

const renderIndex = async (documents: AgentContextDocument[]) => {
  const context: PipelineContext = {
    initialState: { messages: [], model: 'claude-sonnet-5-5', provider: 'lobehub' },
    isAborted: false,
    messages: [
      {
        content: 'Fix the table',
        createdAt: '2026-11-13T00:10:20.000Z',
        id: 'user-1',
        role: 'user',
      },
    ],
    metadata: { maxTokens: 4096, model: 'claude-sonnet-5-5' },
  };
  const result = await new AgentDocumentContextInjector({ documents }).process(context);
  return result.messages[0].content as string;
};

describe('freezeAgentDocumentIndexFacts', () => {
  // Regression: the index sits at the front of the prompt. A document the run
  // edited changed its SIZE / UPDATED (and moved to the top by recency), so the
  // whole cached conversation behind it was written to the cache again.
  it('keeps the index byte-identical after the run edits a document', async () => {
    const first = freezeAgentDocumentIndexFacts(beforeEdit(), undefined);
    const firstIndex = await renderIndex(first.documents);
    // Rendered live, the edit changes the row (14k, 2026-11-13, first row).
    expect(await renderIndex(afterEdit())).not.toBe(firstIndex);

    const next = freezeAgentDocumentIndexFacts(afterEdit(), first.facts);

    expect(await renderIndex(next.documents)).toBe(firstIndex);
    expect(firstIndex).toContain('9.4k');
    expect(next.facts).toBeUndefined();
  });

  it('records every progressive document on first sight', () => {
    const { documents, facts } = freezeAgentDocumentIndexFacts(beforeEdit(), undefined);

    expect(documents).toEqual(beforeEdit());
    expect(facts).toEqual({
      [OLDER_ID]: { contentCharCount: 13_200, updatedAt: '2026-05-28T00:00:00.000Z' },
      [REPORT_ID]: { contentCharCount: 9_400, updatedAt: '2026-05-01T00:00:00.000Z' },
    });
  });

  it('adds a document first seen mid-run and keeps the frozen rows', () => {
    const frozen: AgentDocumentIndexFacts = {
      [REPORT_ID]: { contentCharCount: 9_400, updatedAt: '2026-05-01T00:00:00.000Z' },
    };
    const created = progressiveDoc({
      content: 'new notes',
      id: 'new-doc',
      title: 'Notes',
      updatedAt: '2026-11-13T00:11:00.000Z',
    });

    const { documents, facts } = freezeAgentDocumentIndexFacts([afterEdit()[1], created], frozen);

    expect(documents[0]).toMatchObject({
      contentCharCount: 9_400,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(documents[1]).toBe(created);
    expect(facts).toEqual({
      ...frozen,
      'new-doc': { contentCharCount: 9, updatedAt: '2026-11-13T00:11:00.000Z' },
    });
  });

  it('leaves always-loaded documents live so their content stays current', () => {
    const inline = progressiveDoc({
      content: 'edited rules',
      id: 'rules',
      policyLoad: 'always',
      updatedAt: '2026-11-13T00:11:00.000Z',
    });

    const { documents, facts } = freezeAgentDocumentIndexFacts([inline], {
      rules: { contentCharCount: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(documents[0]).toBe(inline);
    expect(facts).toBeUndefined();
  });
});
