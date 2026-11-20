import { normalizeCanvasPath } from '@lobechat/canvas';
import { DEFAULT_TOOL_RESULT_MAX_LENGTH } from '@lobechat/prompts/toolResult';
import { describe, expect, it, vi } from 'vitest';

import type { ReadCanvasParams } from '../types';
import { CanvasExecutionRuntime, type CanvasToolService } from '.';

const metadata = {
  entry: 'index.html',
  fileCount: 1,
  manifestKey: 'canvas/u/cvs_1/manifests/a.json',
  runtimeMajor: 1,
  totalSize: 120,
};

const createService = (overrides: Partial<CanvasToolService> = {}): CanvasToolService => ({
  create: vi.fn().mockResolvedValue({
    canvasId: 'cvs_1',
    description: 'Up 23%',
    metadata,
    ok: true,
    title: 'Cost report',
  }),
  hasReadGuide: vi.fn().mockResolvedValue(true),
  list: vi.fn().mockResolvedValue([]),
  read: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue({
    canvasId: 'cvs_1',
    description: 'Up 23%',
    metadata,
    ok: true,
    title: 'Cost report',
  }),
  ...overrides,
});

const createParams = {
  files: [{ content: '<lobe-alert>x</lobe-alert>', path: 'index.html' }],
  title: 'Cost report',
};

describe('CanvasExecutionRuntime', () => {
  it('returns the guide with the generated component reference', async () => {
    const runtime = new CanvasExecutionRuntime(createService());

    const result = await runtime.readCanvasGuide();

    expect(result.success).toBe(true);
    expect(result.content).toContain('### <lobe-stat>');
    expect(result.content).toContain('There is no fixed template');
    expect(result.content).not.toContain('Conclusion first');
    expect(result.state).toEqual({ guideRead: true });
  });

  it('refuses to write before the guide was read in this conversation', async () => {
    const service = createService({ hasReadGuide: vi.fn().mockResolvedValue(false) });
    const runtime = new CanvasExecutionRuntime(service);

    const result = await runtime.createCanvas(createParams);

    expect(result.success).toBe(false);
    expect(result.content).toContain('readCanvasGuide');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('creates a canvas and registers its version as a Work', async () => {
    const onWorkRegistration = vi.fn();
    const runtime = new CanvasExecutionRuntime(createService());

    const result = await runtime.createCanvas(createParams, { onWorkRegistration });

    expect(result.success).toBe(true);
    expect(result.content).toContain('cvs_1');
    expect(result.state).toMatchObject({ canvasId: 'cvs_1', metadata });
    expect(onWorkRegistration).toHaveBeenCalledWith({
      action: 'register',
      canvas: {
        canvasId: 'cvs_1',
        description: 'Up 23%',
        metadata,
        title: 'Cost report',
        toolName: 'createCanvas',
      },
      type: 'canvas',
    });
  });

  it('reports validation issues with their location and registers nothing', async () => {
    const onWorkRegistration = vi.fn();
    const runtime = new CanvasExecutionRuntime(
      createService({
        create: vi.fn().mockResolvedValue({
          issues: [
            {
              file: 'index.html',
              line: 3,
              message: '<lobe-nope> is not a Canvas component.',
              rule: 'unknown-component',
            },
          ],
          ok: false,
        }),
      }),
    );

    const result = await runtime.createCanvas(createParams, { onWorkRegistration });

    expect(result.success).toBe(false);
    expect(result.content).toContain('index.html:3');
    expect(result.content).toContain('<lobe-nope> is not a Canvas component.');
    expect(result.state.issues).toHaveLength(1);
    expect(onWorkRegistration).not.toHaveBeenCalled();
  });

  it('updates a canvas and registers the new version under updateCanvas', async () => {
    const onWorkRegistration = vi.fn();
    const service = createService();
    const runtime = new CanvasExecutionRuntime(service);

    const result = await runtime.updateCanvas(
      { canvasId: 'cvs_1', edits: [{ newText: 'b', oldText: 'a', path: 'index.html' }] },
      { onWorkRegistration },
    );

    expect(result.success).toBe(true);
    expect(service.update).toHaveBeenCalledWith(expect.objectContaining({ canvasId: 'cvs_1' }));
    expect(onWorkRegistration.mock.calls[0][0].canvas.toolName).toBe('updateCanvas');
  });

  it('reads a canvas file listing and text contents', async () => {
    const runtime = new CanvasExecutionRuntime(
      createService({
        read: vi.fn().mockResolvedValue({
          canvasId: 'cvs_1',
          description: null,
          files: [
            { path: 'index.html', size: 30 },
            { path: 'logo.png', size: 900 },
          ],
          texts: [{ content: '<h1>Hi</h1>', path: 'index.html' }],
          title: 'Cost report',
        }),
      }),
    );

    const result = await runtime.readCanvas({ canvasId: 'cvs_1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('logo.png (900 bytes)');
    expect(result.content).toContain('<h1>Hi</h1>');
  });

  describe('reading long files', () => {
    /** A service that reads like the real one: whole files, filtered by `paths`. */
    const projectService = (texts: Record<string, string>, binaries: Record<string, number> = {}) =>
      createService({
        read: vi.fn(async (params: ReadCanvasParams) => {
          const requested = params.paths?.map((path) => normalizeCanvasPath(path));
          const files = [
            ...Object.entries(texts).map(([path, content]) => ({ path, size: content.length })),
            ...Object.entries(binaries).map(([path, size]) => ({ path, size })),
          ];
          return {
            canvasId: params.canvasId,
            description: null,
            files,
            texts: Object.entries(texts)
              .filter(([path]) => !requested || requested.includes(path))
              .map(([path, content]) => ({ content, path })),
            title: 'Literature review',
          };
        }),
      });

    // Shaped like the vent: a CJK-heavy index.html of ~64k characters (~114 KB of UTF-8).
    const longPage = Array.from(
      { length: 1380 },
      (_, index) =>
        `<p data-row="${index + 1}">第 ${index + 1} 条：文献综述的核查结论与引用来源。</p>`,
    ).join('\n');

    const nextCall = (content: string) => {
      const match = content.match(/call readCanvas again with (\{[^\n]*?\})\./);
      return match ? (JSON.parse(match[1]) as ReadCanvasParams) : undefined;
    };

    const fileBody = (content: string, path: string) =>
      content.match(
        new RegExp(`<file path="${path.replace('.', '\\.')}"[^>]*>\n([\\s\\S]*?)\n</file>`),
      )?.[1];

    it('pages a file over one response to the end instead of asking to read it on its own', async () => {
      expect(longPage.length).toBeGreaterThan(60_000);
      const runtime = new CanvasExecutionRuntime(projectService({ 'index.html': longPage }));

      const windows: string[] = [];
      let params: ReadCanvasParams | undefined = { canvasId: 'cvs_1', paths: ['index.html'] };
      let calls = 0;
      while (params) {
        calls += 1;
        expect(calls).toBeLessThanOrEqual(10);
        const result = await runtime.readCanvas(params);

        expect(result.success).toBe(true);
        expect(result.content.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_MAX_LENGTH);
        expect(result.content).not.toContain('read this file on its own');
        windows.push(fileBody(result.content, 'index.html')!);
        params = nextCall(result.content);
        if (params) expect(params).toMatchObject({ canvasId: 'cvs_1', paths: ['index.html'] });
      }

      expect(calls).toBeGreaterThan(1);
      expect(windows.join('\n')).toBe(longPage);
    });

    it('marks a partial window with its line range and the call for the next one', async () => {
      const runtime = new CanvasExecutionRuntime(projectService({ 'index.html': longPage }));

      const result = await runtime.readCanvas({ canvasId: 'cvs_1', paths: ['index.html'] });

      expect(result.content).toMatch(
        /<file path="index\.html" lines="1-\d+" total_lines="1380" total_chars="\d+" truncated="true">/,
      );
      expect(result.content).toMatch(
        /\[Showing lines 1-\d+ of 1380 lines, \d+ characters\. To continue, call readCanvas again with \{"canvasId":"cvs_1","paths":\["index\.html"\],"offset":\d+\}\.\]/,
      );
    });

    it('returns small files whole next to the first window of a large one', async () => {
      const runtime = new CanvasExecutionRuntime(
        projectService(
          {
            'index.html': longPage,
            'audit.json': '{"checked":12}',
            'literature-review.json': '{"sources":3}',
          },
          { 'logo.png': 900 },
        ),
      );

      const result = await runtime.readCanvas({ canvasId: 'cvs_1' });

      expect(result.content.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_MAX_LENGTH);
      expect(result.content).toContain('<file path="audit.json">\n{"checked":12}\n</file>');
      expect(result.content).toContain(
        '<file path="literature-review.json">\n{"sources":3}\n</file>',
      );
      expect(result.content).toContain('<p data-row="1">');
      expect(nextCall(result.content)).toMatchObject({ paths: ['index.html'] });
      expect(result.content.indexOf('index.html" lines=')).toBeLessThan(
        result.content.indexOf('<file path="audit.json">'),
      );
    });

    it('names the files left out of a full response with the call that reads each alone', async () => {
      const runtime = new CanvasExecutionRuntime(
        projectService({ 'index.html': longPage, 'report.html': longPage }),
      );

      const result = await runtime.readCanvas({ canvasId: 'cvs_1' });

      expect(result.content.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_MAX_LENGTH);
      expect(result.content).not.toContain('<file path="report.html"');
      expect(result.content).toContain(
        `[This response is full, so these files were not read: report.html (${longPage.length} characters). Read each one on its own, e.g. call readCanvas again with {"canvasId":"cvs_1","paths":["report.html"]}.]`,
      );
    });

    it('reads the requested line range and keeps limit in the next call', async () => {
      const runtime = new CanvasExecutionRuntime(projectService({ 'index.html': longPage }));

      const result = await runtime.readCanvas({
        canvasId: 'cvs_1',
        limit: '2',
        offset: '600',
        paths: ['index.html'],
      });

      expect(fileBody(result.content, 'index.html')).toBe(
        longPage.split('\n').slice(599, 601).join('\n'),
      );
      expect(result.content).toContain('lines="600-601" total_lines="1380"');
      expect(nextCall(result.content)).toEqual({
        canvasId: 'cvs_1',
        limit: 2,
        offset: 602,
        paths: ['index.html'],
      });
    });

    it('says an offset past the end returned nothing instead of an empty file', async () => {
      const runtime = new CanvasExecutionRuntime(projectService({ 'index.html': 'a\nb' }));

      const result = await runtime.readCanvas({
        canvasId: 'cvs_1',
        offset: 5,
        paths: ['index.html'],
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        'File index.html: [Line 5 is past the end of this text (2 lines, 3 characters)',
      );
      expect(result.content).not.toContain('<file path="index.html"');
      expect(nextCall(result.content)).toBeUndefined();
    });

    it('keeps paging past a line longer than one response', async () => {
      const longLine = `<script type="application/json" data-prop="data">${'x'.repeat(40_000)}</script>`;
      const page = ['<h1>Data</h1>', longLine, '<p>after</p>'].join('\n');
      const runtime = new CanvasExecutionRuntime(projectService({ 'index.html': page }));

      const first = await runtime.readCanvas({ canvasId: 'cvs_1', paths: ['index.html'] });
      const next = nextCall(first.content);

      expect(first.content.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_MAX_LENGTH);
      expect(first.content).toContain(`Line 2 is ${longLine.length} characters long and was cut`);
      expect(next).toMatchObject({ offset: 3, paths: ['index.html'] });

      const second = await runtime.readCanvas(next!);
      expect(fileBody(second.content, 'index.html')).toBe('<p>after</p>');
      expect(nextCall(second.content)).toBeUndefined();
    });

    it('explains requested paths that were not read', async () => {
      const runtime = new CanvasExecutionRuntime(
        projectService({ 'index.html': '<h1>Hi</h1>' }, { 'logo.png': 900 }),
      );

      const result = await runtime.readCanvas({
        canvasId: 'cvs_1',
        paths: ['./index.html', 'logo.png', 'missing.html'],
      });

      expect(result.content).toContain(
        '[logo.png is a binary file, so only its size is listed; missing.html does not exist in this canvas.]',
      );
    });
  });

  it('fails clearly when the canvas does not exist', async () => {
    const runtime = new CanvasExecutionRuntime(createService());

    const result = await runtime.readCanvas({ canvasId: 'cvs_missing' });

    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('cvs_missing');
  });

  it('lists canvases', async () => {
    const runtime = new CanvasExecutionRuntime(
      createService({
        list: vi.fn().mockResolvedValue([
          {
            canvasId: 'cvs_1',
            description: 'Up',
            title: 'Cost report',
            updatedAt: '2026-10-20T10:00:00.000Z',
          },
        ]),
      }),
    );

    const result = await runtime.listCanvases();

    expect(result.content).toContain('cvs_1');
    expect(result.content).toContain('Cost report');
  });
});
