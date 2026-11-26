import { describe, expect, it, vi } from 'vitest';

import { a2uiExecutor } from './lobe-a2ui';

const { readCardDocs, renderUI } = vi.hoisted(() => ({
  readCardDocs: vi.fn(async () => ({ content: 'Chart schema', success: true })),
  renderUI: vi.fn(async () => ({ content: 'Card drawn', success: true })),
}));
vi.mock('@/services/a2ui', () => ({ a2uiService: { readCardDocs, renderUI } }));

describe('client a2ui executor', () => {
  // The catalog schemas, examples and validator are not bundled for the browser; the server runs them.
  it('runs renderUI and readCardDocs on the server', async () => {
    const ctx = {} as never;
    await expect(a2uiExecutor.renderUI({ operations: [] }, ctx)).resolves.toMatchObject({
      content: 'Card drawn',
    });
    expect(renderUI).toHaveBeenCalledWith({ operations: [] });
    await expect(a2uiExecutor.readCardDocs({ components: ['Chart'] }, ctx)).resolves.toMatchObject({
      content: 'Chart schema',
    });
    expect(readCardDocs).toHaveBeenCalledWith({ components: ['Chart'] });
  });
});
