import { describe, expect, it, vi } from 'vitest';

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
