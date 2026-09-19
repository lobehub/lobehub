import { describe, expect, it } from 'vitest';

import { readDocumentProjector } from './agentDocuments';
import { runCommandProjector } from './localSystem';
import { crawlProjector } from './webBrowsing';

const input = (partial: Record<string, unknown> = {}) => ({
  apiName: 'x',
  arguments: '{}',
  content: 'MODEL COPY',
  identifier: 'y',
  ...partial,
});

describe('crawlProjector', () => {
  const page = (content: string) => ({
    crawler: 'naive',
    data: { content, contentType: 'text', description: 'D', title: 'T', url: 'https://a.test' },
    originalUrl: 'https://a.test',
  });

  it('drops the message body, which the crawl render never reads', () => {
    const result = crawlProjector(input({ pluginState: { results: [page('x'.repeat(50_000))] } }));

    expect(result?.content).toBeNull();
  });

  it('keeps the card fields and trims the page body to a preview', () => {
    const body = 'x'.repeat(50_000);

    const result = crawlProjector(input({ pluginState: { results: [page(body)] } }));
    const [projected] = (result?.pluginState as any).results;

    expect(projected.crawler).toBe('naive');
    expect(projected.originalUrl).toBe('https://a.test');
    expect(projected.data).toMatchObject({ description: 'D', title: 'T', url: 'https://a.test' });
    expect(projected.data.content).toHaveLength(200);
    expect(JSON.stringify(projected).length).toBeLessThan(600);
  });

  it('pins the character count to the original body, not the preview', () => {
    const result = crawlProjector(input({ pluginState: { results: [page('x'.repeat(50_000))] } }));

    expect((result?.pluginState as any).results[0].data.length).toBe(50_000);
  });

  it('prefers a stored length over recomputing it', () => {
    const state = {
      results: [
        {
          ...page('x'.repeat(50_000)),
          data: { ...page('x').data, content: 'x'.repeat(50_000), length: 42 },
        },
      ],
    };

    const result = crawlProjector(input({ pluginState: state }));

    expect((result?.pluginState as any).results[0].data.length).toBe(42);
  });

  it('leaves a short page untouched', () => {
    const result = crawlProjector(input({ pluginState: { results: [page('short')] } }));

    expect((result?.pluginState as any).results[0].data.content).toBe('short');
  });

  it('leaves an error result whole, since the card prints its content', () => {
    const errorPage = {
      crawler: 'naive',
      data: { content: 'boom', errorMessage: 'nope', errorType: 'Timeout' },
      originalUrl: 'https://a.test',
    };

    const result = crawlProjector(input({ pluginState: { results: [errorPage] } }));

    expect((result?.pluginState as any).results[0]).toEqual(errorPage);
  });

  it('still drops the duplicated body when the state shape is unknown', () => {
    expect(crawlProjector(input({ pluginState: { weird: true } }))).toEqual({ content: null });
  });
});

describe('runCommandProjector', () => {
  it('drops all three copies of the output and keeps the settled metadata', () => {
    const result = runCommandProjector(
      input({
        pluginState: {
          exitCode: 0,
          outputFiles: ['/tmp/a.log'],
          output: 'OUT',
          stderr: 'warn',
          stdout: 'OUT',
          success: true,
        },
      }),
    );

    expect(result?.content).toBeNull();
    expect(result?.pluginState).toEqual({
      exitCode: 0,
      outputFiles: ['/tmp/a.log'],
      stderr: 'warn',
      success: true,
    });
  });

  it('asks the card itself to fetch, since the card is what renders the output', () => {
    const result = runCommandProjector(input({ pluginState: { stdout: 'OUT' } }));

    expect(result?.storedPayloadNeededBy).toBe('render');
  });

  it('drops a legacy row that only has `output`', () => {
    const result = runCommandProjector(input({ pluginState: { output: 'OUT' } }));

    expect(result?.pluginState).toEqual({});
    expect(result?.content).toBeNull();
  });

  it('still drops the body when state carries no output at all', () => {
    const result = runCommandProjector(input({ pluginState: { exitCode: 0 } }));

    expect(result?.content).toBeNull();
    expect(result?.pluginState).toEqual({ exitCode: 0 });
  });

  it('handles the codex shape, whose extra metadata keys must survive', () => {
    // Observed on production: `stdout` and `output` are byte-identical copies,
    // and the collapsed row reads `success` / `exitCode` — which is why the
    // whole command-output family shares this projector.
    const result = runCommandProjector(
      input({
        pluginState: {
          exitCode: 0,
          isBackground: false,
          omittedOutputCharacters: 120,
          originalOutputLength: 4181,
          output: 'OUT',
          stdout: 'OUT',
          success: true,
        },
      }),
    );

    expect(result?.content).toBeNull();
    expect(result?.pluginState).toEqual({
      exitCode: 0,
      isBackground: false,
      omittedOutputCharacters: 120,
      originalOutputLength: 4181,
      success: true,
    });
  });

  it('strips a body carried without any state, as claude-code/Bash does', () => {
    const result = runCommandProjector(input({ content: 'the output', pluginState: undefined }));

    expect(result).toEqual({ content: null, storedPayloadNeededBy: 'render' });
  });

  it('declines a call that produced nothing to drop', () => {
    expect(
      runCommandProjector(input({ content: '', pluginState: { exitCode: 0 } })),
    ).toBeUndefined();
    expect(runCommandProjector(input({ content: '', pluginState: undefined }))).toBeUndefined();
  });
});

describe('readDocumentProjector', () => {
  it('keeps only what the inspector chip renders', () => {
    const result = readDocumentProjector(
      input({
        pluginState: {
          content: 'x'.repeat(30_000),
          id: 'doc_1',
          title: 'Spec',
          xml: 'y'.repeat(40_000),
        },
      }),
    );

    expect(result).toEqual({
      content: null,
      pluginState: { id: 'doc_1', title: 'Spec' },
      storedPayloadNeededBy: 'render',
    });
  });

  it('drops the duplicated body even without a usable state', () => {
    expect(readDocumentProjector(input({ pluginState: undefined }))).toEqual({
      content: null,
      storedPayloadNeededBy: 'render',
    });
  });
});
