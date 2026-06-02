import { describe, expect, it, vi } from 'vitest';

import { PersonalPagesExecutionRuntime } from './index';

const createRuntime = (overrides = {}) =>
  new PersonalPagesExecutionRuntime({
    createDocument: vi.fn(),
    listDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    replaceContent: vi.fn(),
    ...overrides,
  });

describe('PersonalPagesExecutionRuntime', () => {
  it('createPage routes to service.createDocument and shapes state', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      id: 'page-1',
      title: 'My Notes',
    });
    const runtime = createRuntime({ createDocument });

    const result = await runtime.createPage({ content: 'hello', title: 'My Notes' });

    expect(createDocument).toHaveBeenCalledWith({
      content: 'hello',
      title: 'My Notes',
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ pageId: 'page-1' });
    expect(result.content).toContain('My Notes');
  });

  it('createPage returns failure content when service returns undefined', async () => {
    const createDocument = vi.fn().mockResolvedValue(undefined);
    const runtime = createRuntime({ createDocument });

    const result = await runtime.createPage({ content: 'x', title: 'Fail' });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Failed to create personal page.');
  });

  it('readPage routes to service.readDocument with id and format', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: 'body',
      id: 'page-2',
      litexml: '<doc/>',
      title: 'Page Two',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readPage({ format: 'xml', id: 'page-2' });

    expect(readDocument).toHaveBeenCalledWith({ format: 'xml', id: 'page-2' });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ id: 'page-2', title: 'Page Two' });
  });

  it('readPage returns not-found content when page missing', async () => {
    const readDocument = vi.fn().mockResolvedValue(undefined);
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readPage({ id: 'missing' });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Page not found: missing');
  });

  it('replaceContent routes to service.replaceContent and returns updated state', async () => {
    const replaceContent = vi.fn().mockResolvedValue({ id: 'page-3' });
    const runtime = createRuntime({ replaceContent });

    const result = await runtime.replaceContent({ content: 'new body', id: 'page-3' });

    expect(replaceContent).toHaveBeenCalledWith({ content: 'new body', id: 'page-3' });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ id: 'page-3', updated: true });
  });

  it('replaceContent returns failure content when page missing', async () => {
    const replaceContent = vi.fn().mockResolvedValue(undefined);
    const runtime = createRuntime({ replaceContent });

    const result = await runtime.replaceContent({ content: 'x', id: 'gone' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('gone');
  });

  it('modifyNodes routes to service.modifyNodes and reports operation count', async () => {
    const modifyNodes = vi.fn().mockResolvedValue({ id: 'page-4' });
    const runtime = createRuntime({ modifyNodes });

    const ops = [{ action: 'remove' as const, id: 'node-1' }];
    const result = await runtime.modifyNodes({ id: 'page-4', operations: ops });

    expect(modifyNodes).toHaveBeenCalledWith({ id: 'page-4', operations: ops });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ id: 'page-4', successCount: 1, totalCount: 1 });
  });

  it('modifyNodes returns empty-operations content when no ops', async () => {
    const modifyNodes = vi.fn();
    const runtime = createRuntime({ modifyNodes });

    const result = await runtime.modifyNodes({ id: 'page-4', operations: [] });

    expect(modifyNodes).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toBe('No operations provided.');
  });

  it('listPages routes to service.listDocuments and returns page list', async () => {
    const listDocuments = vi.fn().mockResolvedValue([
      { id: 'page-1', title: 'Alpha' },
      { id: 'page-2', title: 'Beta' },
    ]);
    const runtime = createRuntime({ listDocuments });

    const result = await runtime.listPages();

    expect(listDocuments).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      documents: [
        { id: 'page-1', title: 'Alpha' },
        { id: 'page-2', title: 'Beta' },
      ],
    });
  });

  it('listPages returns an empty documents list when there are no pages', async () => {
    const listDocuments = vi.fn().mockResolvedValue([]);
    const runtime = createRuntime({ listDocuments });

    const result = await runtime.listPages();

    expect(result.success).toBe(true);
    expect(result.state).toEqual({ documents: [] });
  });
});
