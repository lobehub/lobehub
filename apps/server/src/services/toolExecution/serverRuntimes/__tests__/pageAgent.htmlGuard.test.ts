// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pageAgentRuntime } from '../pageAgent';
import { pageSandboxWrapper } from '../pageSandboxSync';

const mocks = vi.hoisted(() => ({
  getDocumentById: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: { ENABLE_PAGE_COLLAB: false } }));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return { getDocumentById: mocks.getDocumentById, updateDocument: mocks.updateDocument };
  }),
}));

const context = {
  documentId: 'doc-1',
  scope: 'page',
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
};

describe('page agent on an HTML page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentById.mockResolvedValue({
      content: '<!doctype html><html><body><p>12</p></body></html>',
      editorData: null,
      fileType: 'custom/html',
      id: 'doc-1',
      title: 'Goal report',
      updatedAt: new Date('2026-01-01'),
    });
  });

  it('refuses a rewrite instead of writing the page back as Markdown', async () => {
    const runtime = pageAgentRuntime.factory(context as any) as Record<
      string,
      (args: unknown, ctx: unknown) => Promise<any>
    >;

    const result = await runtime.initPage({ markdown: 'new body' }, { documentId: 'doc-1' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toMatch(/HTML page/);
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('does not mount the page into sandbox commands, which would hand over HTML as Markdown', async () => {
    const callTool = vi.fn(async () => ({
      result: { exitCode: 0, stdout: 'done' },
      success: true,
    }));
    const sandbox = pageSandboxWrapper(context as any)!({
      callTool,
      exportAndUploadFile: vi.fn(),
    } as any);

    const result = await sandbox.callTool('runCommand', { command: 'ls /mnt/page' });

    expect(callTool).toHaveBeenCalledWith('runCommand', { command: 'ls /mnt/page' });
    expect(String((result.result as any).stdout)).toMatch(/HTML page/);
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });
});
