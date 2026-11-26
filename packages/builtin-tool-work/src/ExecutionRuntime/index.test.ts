import { describe, expect, it, vi } from 'vitest';

import { WorkExecutionRuntime, WorkToolError, type WorkToolService } from './index';

const service = (overrides: Partial<WorkToolService> = {}): WorkToolService => ({
  create: vi.fn(async (args) => ({
    imageCount: args.items?.length,
    title: args.title,
    type: args.type,
    workId: 'wk_1',
  })),
  delete: vi.fn(async (workId) => ({ title: 'Covers', workId })),
  update: vi.fn(async (args) => ({
    imageCount: args.items?.length,
    title: args.title ?? 'Covers',
    type: 'collection' as const,
    workId: args.workId,
  })),
  ...overrides,
});

const images = [{ image: 'file_a' }, { caption: 'Night', image: 'file_b' }];

describe('WorkExecutionRuntime', () => {
  it('creates a collection and names its id, title and image count', async () => {
    const runtime = new WorkExecutionRuntime(service());
    const result = await runtime.createWork({ items: images, title: 'Covers', type: 'collection' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('wk_1');
    expect(result.content).toContain('"Covers"');
    expect(result.content).toContain('2 images');
    expect(result.state).toEqual({
      work: { imageCount: 2, title: 'Covers', type: 'collection', workId: 'wk_1' },
    });
  });

  it('refuses a collection without images and a link without a url, before writing', async () => {
    const svc = service();
    const runtime = new WorkExecutionRuntime(svc);

    const collection = await runtime.createWork({ title: 'Covers', type: 'collection' });
    const link = await runtime.createWork({ title: 'Site', type: 'link' });

    expect(collection.error?.type).toBe('invalid_input');
    expect(link.error?.type).toBe('invalid_input');
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('refuses an update that changes nothing or empties the collection', async () => {
    const svc = service();
    const runtime = new WorkExecutionRuntime(svc);

    expect((await runtime.updateWork({ workId: 'wk_1' })).error?.type).toBe('invalid_input');
    expect((await runtime.updateWork({ items: [], workId: 'wk_1' })).error?.type).toBe(
      'invalid_input',
    );
    expect((await runtime.updateWork({ coverImage: 'file_a', workId: 'wk_1' })).error?.type).toBe(
      'invalid_input',
    );
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('passes the full items list through on update', async () => {
    const svc = service();
    const result = await new WorkExecutionRuntime(svc).updateWork({
      items: images,
      workId: 'wk_1',
    });

    expect(svc.update).toHaveBeenCalledWith({ items: images, workId: 'wk_1' });
    expect(result.content).toContain('2 images');
  });

  it('counts a single image in the singular', async () => {
    const result = await new WorkExecutionRuntime(service()).createWork({
      items: [{ image: 'file_a' }],
      title: 'Cover',
      type: 'collection',
    });

    expect(result.content).toContain(', 1 image)');
  });

  it('deletes a Work and says the images stay', async () => {
    const result = await new WorkExecutionRuntime(service()).deleteWork({ workId: 'wk_1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('wk_1');
    expect(result.state).toEqual({ deleted: { title: 'Covers', workId: 'wk_1' } });
  });

  it('keeps a known error code and turns anything else into unknown', async () => {
    const known = new WorkExecutionRuntime(
      service({
        delete: async () => {
          throw new WorkToolError('not_found', 'Work wk_x not found');
        },
      }),
    );
    const unknown = new WorkExecutionRuntime(
      service({
        delete: async () => {
          throw new Error('Failed query: delete from "works" where "id" = $1 params: wk_x');
        },
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const notFound = await known.deleteWork({ workId: 'wk_x' });
    expect(notFound).toMatchObject({
      content: 'Work wk_x not found',
      error: { message: 'Work wk_x not found', type: 'not_found' },
      state: { error: { code: 'not_found', message: 'Work wk_x not found' } },
      success: false,
    });
    // A database error never reaches the model or the stored tool state.
    const failed = await unknown.deleteWork({ workId: 'wk_x' });
    expect(failed).toMatchObject({
      content: 'Failed to delete the Work. Try again later.',
      error: { type: 'unknown' },
      state: { error: { code: 'unknown' } },
    });
    expect(JSON.stringify(failed)).not.toContain('Failed query');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
