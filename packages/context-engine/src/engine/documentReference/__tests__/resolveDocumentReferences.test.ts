import { describe, expect, it, vi } from 'vitest';

import {
  MAX_DOCUMENT_REFERENCE_CHARS,
  MAX_DOCUMENT_REFERENCES,
  parseReferDocumentTags,
  resolveDocumentReferences,
} from '../resolveDocumentReferences';

describe('parseReferDocumentTags', () => {
  it('parses tags across messages and dedupes by id', () => {
    const refs = parseReferDocumentTags([
      { content: 'See <refer_document name="Voice" id="doc-1" /> and' },
      { content: 'again <refer_document name="Voice" id="doc-1" />' },
      { content: '<refer_document id="doc-2" name="Spec" />' },
      { content: [{ type: 'text', text: '<refer_document id="ignored" />' }] },
    ]);

    expect(refs).toEqual([
      { documentId: 'doc-1', latest: false, title: 'Voice' },
      { documentId: 'doc-2', latest: false, title: 'Spec' },
    ]);
  });

  it('orders references by their most recent use', () => {
    const refs = parseReferDocumentTags([
      { content: '<refer_document name="A" id="doc-a" />', role: 'user' },
      { content: '<refer_document name="B" id="doc-b" />', role: 'user' },
      { content: '<refer_document id="doc-a" />', role: 'user' },
    ]);

    expect(refs).toEqual([
      { documentId: 'doc-b', latest: false, title: 'B' },
      { documentId: 'doc-a', latest: true, title: 'A' },
    ]);
  });

  it('reads tags whose markup was markdown-escaped', () => {
    expect(
      parseReferDocumentTags([{ content: '\\<refer\\_document name="Voice" id="doc-1" />' }]),
    ).toEqual([{ documentId: 'doc-1', latest: true, title: 'Voice' }]);
  });

  it('ignores refer_topic tags', () => {
    expect(parseReferDocumentTags([{ content: '<refer_topic name="T" id="tpc_1" />' }])).toEqual(
      [],
    );
  });
});

describe('resolveDocumentReferences', () => {
  it('returns undefined without tags', async () => {
    const lookup = vi.fn();
    expect(await resolveDocumentReferences([{ content: 'plain' }], lookup)).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves content and prefers the stored title', async () => {
    const refs = await resolveDocumentReferences(
      [{ content: '<refer_document name="Old" id="doc-1" />' }],
      async () => ({ content: 'Body', title: 'Current' }),
    );

    expect(refs).toEqual([{ content: 'Body', documentId: 'doc-1', title: 'Current' }]);
  });

  it('truncates long content to the budget', async () => {
    const refs = await resolveDocumentReferences(
      [{ content: '<refer_document name="Long" id="doc-1" />' }],
      async () => ({ content: 'x'.repeat(MAX_DOCUMENT_REFERENCE_CHARS + 10) }),
    );

    expect(refs?.[0].content).toHaveLength(MAX_DOCUMENT_REFERENCE_CHARS);
    expect(refs?.[0].truncated).toBe(true);
    expect(refs?.[0].title).toBe('Long');
  });

  it('keeps a reference without content when the lookup misses or throws', async () => {
    const refs = await resolveDocumentReferences(
      [
        {
          content:
            '<refer_document name="Missing" id="doc-1" /><refer_document name="Broken" id="doc-2" />',
        },
      ],
      async (id) => {
        if (id === 'doc-2') throw new Error('boom');
        return null;
      },
    );

    expect(refs).toEqual([
      { documentId: 'doc-1', title: 'Missing' },
      { documentId: 'doc-2', title: 'Broken' },
    ]);
  });

  it('inlines only documents the latest user message references', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body' }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="Old" id="doc-old" />', role: 'user' },
        { content: 'Done.', role: 'assistant' },
        { content: '<refer_document name="New" id="doc-new" />', role: 'user' },
        { content: 'Reading.', role: 'assistant' },
      ],
      lookup,
    );

    expect(refs).toEqual([
      { documentId: 'doc-old', earlierTurn: true, title: 'Old' },
      { content: 'Body', documentId: 'doc-new', title: 'New' },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('doc-new');
  });

  it('inlines a document referenced again after older ones exceed the cap', async () => {
    const count = MAX_DOCUMENT_REFERENCES + 1;
    const messages = [
      ...Array.from({ length: count }, (_, i) => ({
        content: `<refer_document name="D${i}" id="doc-${i}" />`,
        role: 'user',
      })),
      { content: '<refer_document name="D0" id="doc-0" />', role: 'user' },
    ];
    const lookup = vi.fn(async () => ({ content: 'c' }));

    const refs = await resolveDocumentReferences(messages, lookup);

    expect(refs?.filter((ref) => ref.earlierTurn)).toHaveLength(MAX_DOCUMENT_REFERENCES);
    expect(refs?.at(-1)).toMatchObject({ content: 'c', documentId: 'doc-0' });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest user turn during a multi-step tool loop and ignores echoed tags', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body' }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="New" id="doc-new" />', role: 'user' },
        { content: 'Echo <refer_document name="New" id="doc-new" />', role: 'assistant' },
        { content: '<refer_document name="Other" id="doc-other" />', role: 'tool' },
      ],
      lookup,
    );

    expect(refs).toEqual([{ content: 'Body', documentId: 'doc-new', title: 'New' }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('inlines earlier-turn documents when asked to', async () => {
    const lookup = vi.fn(async (id: string) => ({ content: `Body ${id}` }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="Old" id="doc-old" />', role: 'user' },
        { content: 'Follow-up', role: 'user' },
      ],
      lookup,
      { inlineEarlierTurns: true },
    );

    expect(refs).toEqual([{ content: 'Body doc-old', documentId: 'doc-old', title: 'Old' }]);
  });

  it('caps the number of inlined documents to the most recent ones', async () => {
    const count = MAX_DOCUMENT_REFERENCES + 2;
    const content = Array.from(
      { length: count },
      (_, i) => `<refer_document name="D${i}" id="doc-${i}" />`,
    ).join(' ');
    const lookup = vi.fn(async () => ({ content: 'c' }));

    const refs = await resolveDocumentReferences([{ content, role: 'user' }], lookup);

    expect(refs).toHaveLength(MAX_DOCUMENT_REFERENCES);
    expect(refs?.[0].documentId).toBe('doc-2');
    expect(lookup).toHaveBeenCalledTimes(MAX_DOCUMENT_REFERENCES);
  });
});
