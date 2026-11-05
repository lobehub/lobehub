import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { DocumentReferenceContextInjector } from '../DocumentReferenceContextInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('DocumentReferenceContextInjector', () => {
  it('skips when disabled or without references', async () => {
    for (const config of [{ enabled: false }, { documentReferences: [], enabled: true }]) {
      const injector = new DocumentReferenceContextInjector(config);
      const result = await injector.process(
        createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]),
      );

      expect(result.messages[0].content).toBe('Hello');
      expect(result.metadata.documentReferenceInjected).toBeUndefined();
    }
  });

  it('appends referenced document content to the last user message', async () => {
    const injector = new DocumentReferenceContextInjector({
      documentReferences: [
        { content: '# Voice\nShort sentences.', documentId: 'doc-1', title: 'Voice "Guide"' },
      ],
      enabled: true,
    });
    const result = await injector.process(
      createContext([
        { content: 'First', id: 'user-1', role: 'user' },
        { content: 'Reply', id: 'assistant-1', role: 'assistant' },
        { content: 'Use <refer_document name="Voice" id="doc-1" />', id: 'user-2', role: 'user' },
      ]),
    );

    expect(result.messages[0].content).toBe('First');
    const last = result.messages[2].content as string;
    expect(last).toContain('<referred_documents');
    expect(last).toContain('<document id="doc-1" title="Voice &quot;Guide&quot;">');
    expect(last).toContain('# Voice\nShort sentences.');
    expect(last).toContain('document_reference_context');
    expect(result.metadata.documentReferenceInjected).toBe(true);
    expect(result.metadata.documentReferenceCount).toBe(1);
  });

  it('marks truncated and unreadable documents so the agent can read them via the tool', async () => {
    const injector = new DocumentReferenceContextInjector({
      canReadDocuments: true,
      documentReferences: [
        { content: 'partial', documentId: 'doc-1', title: 'Long', truncated: true },
        { documentId: 'doc-2', title: 'Gone' },
        { documentId: 'doc-3', earlierTurn: true, title: 'Before' },
      ],
      enabled: true,
    });
    const result = await injector.process(
      createContext([{ content: 'Hi', id: 'user-1', role: 'user' }]),
    );
    const content = result.messages[0].content as string;

    expect(content).toContain('<document id="doc-1" title="Long" truncated="true">');
    expect(content).toContain('<document id="doc-2" title="Gone" status="unavailable" />');
    expect(content).toContain('<document id="doc-3" title="Before" status="earlier_turn" />');
    expect(content).toContain('readDocument');
  });

  it('does not point at readDocument when the documents tool is not sent', async () => {
    const injector = new DocumentReferenceContextInjector({
      canReadDocuments: false,
      documentReferences: [
        { content: 'partial', documentId: 'doc-1', title: 'Long', truncated: true },
      ],
      enabled: true,
    });
    const result = await injector.process(
      createContext([{ content: 'Hi', id: 'user-1', role: 'user' }]),
    );
    const content = result.messages[0].content as string;

    expect(content).toContain('<document id="doc-1" title="Long" truncated="true">');
    expect(content).not.toContain('readDocument');
    expect(content).toContain('tell the user');
  });
});
