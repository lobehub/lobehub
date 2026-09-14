import {
  hashRewriteText,
  IAISessionService,
  type IEditor,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import {
  clearPageAIProvenanceFocus,
  focusPageAIProvenance,
  inspectPageAIProvenanceContinuation,
  setPageAIProvenanceHighlight,
} from './aiProvenance';

const createEditor = (
  service: Record<string, unknown> | null,
  root?: HTMLElement,
  markdownService: Record<string, unknown> | null = null,
): IEditor =>
  ({
    getLexicalEditor: () => null,
    getRootElement: () => root ?? null,
    requireService: vi.fn((serviceId) => {
      if (serviceId === IAISessionService) return service;
      if (serviceId === IMarkdownShortCutService) return markdownService;
      return null;
    }),
    setSelection: vi.fn().mockResolvedValue(true),
    focus: vi.fn(),
  }) as unknown as IEditor;

describe('Page AI provenance service adapter', () => {
  it('treats an empty local projection as unavailable, not deleted', () => {
    const service = { getRanges: vi.fn(() => []) };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service), {
        outputText: 'A concise result',
        sessionId: 'session-1',
      }),
    ).toMatchObject({ ranges: [], status: 'unavailable' });
    expect(service.getRanges).toHaveBeenCalledWith('session-1');
  });

  it('reports changed when only part of the generated output remains', () => {
    const service = { getRanges: vi.fn(() => [{ text: 'A concise ' }]) };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service), {
        outputText: 'A concise result',
        sessionId: 'session-1',
      }).status,
    ).toBe('changed');
  });

  it('reports ready only when marked ranges reconstruct the applied output', () => {
    const service = {
      getRanges: vi.fn(() => [{ text: 'A concise ' }, { text: 'result' }]),
    };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service), {
        outputText: 'A concise result',
        sessionId: 'session-1',
      }).status,
    ).toBe('ready');
  });

  it('keeps legacy literal Markdown markers when the raw projection still matches', () => {
    const service = { getRanges: vi.fn(() => [{ text: '**literal**' }]) };
    const markdown = {
      parseMarkdownToLexical: vi.fn(() => ({
        children: [{ children: [{ text: 'literal', type: 'text' }], type: 'paragraph' }],
        type: 'root',
      })),
    };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service, undefined, markdown), {
        outputText: '**literal**',
        sessionId: 'session-1',
      }).status,
    ).toBe('ready');
    expect(markdown.parseMarkdownToLexical).not.toHaveBeenCalled();
  });

  it('compares Markdown output against the parser-owned applied text projection', () => {
    const service = {
      getRanges: vi.fn(() => [
        { text: 'Bold' },
        { text: 'sort' },
        { text: 'First' },
        { text: 'Second' },
      ]),
    };
    const markdown = {
      parseMarkdownToLexical: vi.fn(() => ({
        children: [
          {
            children: [
              { format: 1, text: 'Bold', type: 'text' },
              { format: 16, text: 'sort', type: 'text' },
            ],
            type: 'paragraph',
          },
          {
            children: [
              { children: [{ text: 'First', type: 'text' }], type: 'listitem' },
              { children: [{ text: 'Second', type: 'text' }], type: 'listitem' },
            ],
            type: 'list',
          },
        ],
        type: 'root',
      })),
    };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service, undefined, markdown), {
        outputText: '**Bold** `sort`\n\n- First\n- Second',
        sessionId: 'session-1',
      }).status,
    ).toBe('ready');
    expect(markdown.parseMarkdownToLexical).toHaveBeenCalledWith(
      '**Bold** `sort`\n\n- First\n- Second',
    );
  });

  it('uses the durable applied-text hash when the raw Markdown is unavailable to the parser', () => {
    const service = { getRanges: vi.fn(() => [{ text: 'BoldsortFirstChanged' }]) };

    expect(
      inspectPageAIProvenanceContinuation(createEditor(service), {
        appliedTextHash: hashRewriteText('BoldsortFirstSecond'),
        outputText: '**Bold** `sort`\n\n- First\n- Second',
        sessionId: 'session-1',
      }).status,
    ).toBe('changed');
  });

  it('uses hover state independently from active focus', () => {
    const service = { setHoveredSessionId: vi.fn() };
    const editor = createEditor(service);

    setPageAIProvenanceHighlight(editor, { active: true, sessionId: 'session-1' });
    setPageAIProvenanceHighlight(editor, { active: false, sessionId: 'session-1' });

    expect(service.setHoveredSessionId).toHaveBeenNthCalledWith(1, 'session-1');
    expect(service.setHoveredSessionId).toHaveBeenNthCalledWith(2, null);
  });

  it('focuses a marked session and scrolls its DOM projection', () => {
    const element = document.createElement('span');
    element.dataset.aiSessionId = 'session-1';
    element.scrollIntoView = vi.fn();
    const root = document.createElement('div');
    root.append(element);
    const service = {
      focusSession: vi.fn(),
      getRanges: vi.fn(() => [{ key: 'node-1', nodeKey: 'node-1', text: 'A concise result' }]),
      refresh: vi.fn(),
    };

    focusPageAIProvenance(createEditor(service, root), { sessionId: 'session-1' });

    expect(service.refresh).not.toHaveBeenCalled();
    expect(service.focusSession).toHaveBeenCalledWith('session-1');
    expect(element.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('retains session focus while the local provenance projection is hydrating', () => {
    const service = {
      clearSessionFocus: vi.fn(),
      focusSession: vi.fn(),
      getActiveSessionId: vi.fn(() => 'session-1'),
      getRanges: vi.fn(() => []),
    };

    focusPageAIProvenance(createEditor(service), {
      selection: {
        endNodeId: 'node-1',
        endOffset: 8,
        kind: 'block',
        quotedText: 'A concise result',
        quotedTextHash: 'hash',
        startNodeId: 'node-1',
        startOffset: 0,
      },
      sessionId: 'session-1',
    });

    expect(service.focusSession).toHaveBeenCalledWith('session-1');
    expect(service.clearSessionFocus).not.toHaveBeenCalled();
  });

  it('avoids native selection and editor focus for the composer', async () => {
    const editor = createEditor(null);

    focusPageAIProvenance(editor, {
      focusEditor: false,
      selection: {
        endNodeId: 'node-1',
        endOffset: 8,
        kind: 'block',
        startNodeId: 'node-1',
        startOffset: 0,
      },
    });

    await Promise.resolve();

    expect(editor.setSelection).not.toHaveBeenCalled();
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it('clears active focus without clearing hover state', () => {
    const service = { clearSessionFocus: vi.fn() };

    clearPageAIProvenanceFocus(createEditor(service));

    expect(service.clearSessionFocus).toHaveBeenCalledOnce();
  });

  it('can navigate to a session without leaving a persistent active highlight', () => {
    const element = document.createElement('span');
    element.dataset.aiSessionId = 'session-1';
    element.scrollIntoView = vi.fn();
    const root = document.createElement('div');
    root.append(element);
    const service = {
      clearSessionFocus: vi.fn(),
      focusSession: vi.fn(),
      getRanges: () => [{ key: 'node-1', nodeKey: 'node-1', text: 'result' }],
    };
    focusPageAIProvenance(createEditor(service, root), {
      sessionId: 'session-1',
      highlight: false,
    });
    expect(service.focusSession).not.toHaveBeenCalled();
    expect(service.clearSessionFocus).toHaveBeenCalled();
    expect(element.scrollIntoView).toHaveBeenCalled();
  });
});
