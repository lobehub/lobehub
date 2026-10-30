// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createHeadlessEditor } from '@lobehub/editor/headless';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DbPageSessions } from '../dbSession';
import { withPageSync } from '../sandboxSync';

const run = promisify(execFile);

const store = vi.hoisted(() => ({
  conflictNext: undefined as 'DocumentLocked' | 'DocumentVersionMismatch' | undefined,
  row: null as any,
  updates: [] as any[],
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => store.row && { ...store.row };
    updateDocument = async (_id: string, params: any) => {
      if (store.conflictNext) {
        const code = store.conflictNext;
        store.conflictNext = undefined;
        throw new TRPCError({ cause: { data: { code } } as any, code: 'CONFLICT' });
      }
      if (params.expectedUpdatedAt.getTime() !== store.row.updatedAt.getTime()) {
        throw new TRPCError({
          cause: { data: { code: 'DocumentVersionMismatch' } } as any,
          code: 'CONFLICT',
        });
      }
      store.updates.push(params);
      store.row = {
        ...store.row,
        ...(params.editorData ? { content: params.content, editorData: params.editorData } : {}),
        ...(params.title ? { title: params.title } : {}),
        updatedAt: new Date(store.row.updatedAt.getTime() + 1000),
      };
      return { historyAppended: true, updatedAt: store.row.updatedAt };
    };
  },
}));

const hooks = { duringCommand: undefined as undefined | (() => void) };

const shellSandbox = {
  callTool: async (_tool: string, params: Record<string, any>) => {
    hooks.duringCommand?.();
    try {
      const { stdout, stderr } = await run('sh', ['-c', params.command]);
      return { result: { exitCode: 0, stderr, stdout }, success: true };
    } catch (error: any) {
      return {
        result: { exitCode: error.code ?? 1, stderr: error.stderr, stdout: error.stdout },
        success: true,
      };
    }
  },
  exportAndUploadFile: async () => ({ filename: '', success: false }),
};

const seedRow = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return { content: markdown, editorData, title: 'Page', updatedAt: new Date('2026-01-01') };
};

// Editor state with fixed node ids: paragraph 2n-1 holding text 2n.
const pageData = (paragraphs: string[]) => ({
  root: {
    children: paragraphs.map((text, i) => ({
      children: [
        {
          detail: 0,
          format: 0,
          id: String(2 * i + 2),
          mode: 'normal',
          style: '',
          text,
          type: 'text',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      id: String(2 * i + 1),
      indent: 0,
      type: 'paragraph',
      version: 1,
    })),
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

const markdownOfRow = () => {
  const editor = createHeadlessEditor();
  editor.hydrateEditorData(store.row.editorData, { keepId: true });
  const { markdown } = editor.export();
  editor.destroy();
  return markdown;
};

describe('DbPageSessions through withPageSync', () => {
  let pageDir: string;
  let exec: (command: string) => Promise<string>;

  beforeEach(() => {
    hooks.duringCommand = undefined;
    store.updates = [];
    store.conflictNext = undefined;
    store.row = seedRow('para one\n\npara two\n');
    pageDir = path.join(mkdtempSync(path.join(tmpdir(), 'page-db-')), 'page');
    const sessions = new DbPageSessions({} as any, {
      agentId: 'agt_1',
      operationId: 'op_1',
      saveSource: 'llm_call',
      userId: 'u1',
    });
    const sandbox = withPageSync(shellSandbox, { documentId: 'doc_1', pageDir, sessions });
    exec = async (command) => {
      const res = await sandbox.callTool('runCommand', { command });
      return String((res.result as any).stdout);
    };
  });

  const sed = (from: string, to: string) =>
    `sed -i.bak 's/${from}/${to}/' ${pageDir}/doc.xml && rm ${pageDir}/doc.xml.bak`;

  it('writes an edit to the stored page as an AI version of the run', async () => {
    const out = await exec(sed('para two', 'para TWO'));

    expect(out).toContain('1 modified');
    expect(markdownOfRow()).toBe('para one\n\npara TWO\n');
    expect(store.updates[0]).toMatchObject({
      history: { agentId: 'agt_1', editorIds: ['u1'], operationId: 'op_1' },
      saveSource: 'llm_call',
    });
  });

  it('does not write when a command only reads the page', async () => {
    await exec(`cat ${pageDir}/doc.xml`);

    expect(store.updates).toHaveLength(0);
  });

  it('keeps ids stable across calls', async () => {
    const before = await exec(`cat ${pageDir}/.meta/outline`);
    await exec(sed('para two', 'para TWO'));
    const after = await exec(`cat ${pageDir}/.meta/outline`);

    const idOne = before.match(/^(\S+) p para one$/m)?.[1];
    expect(idOne).toBeTruthy();
    expect(after).toMatch(new RegExp(`^${idOne} p para one$`, 'm'));
  });

  it('writes nothing and asks to re-read when the page changed after it was read', async () => {
    store.conflictNext = 'DocumentVersionMismatch';

    const out = await exec(sed('para two', 'para TWO'));

    expect(out).toContain('Nothing was written: the page changed after this command read it');
    expect(markdownOfRow()).toBe('para one\n\npara two\n');
  });

  it('reports a page another member is editing', async () => {
    store.conflictNext = 'DocumentLocked';

    const out = await exec(sed('para two', 'para TWO'));

    expect(out).toContain('another member is editing the page');
  });

  it('keeps both edits of parallel calls in one step', async () => {
    const [a, b] = await Promise.all([
      exec(sed('para one', 'para ONE')),
      exec(sed('para two', 'para TWO')),
    ]);

    expect(a).toContain('1 modified');
    expect(b).toContain('1 modified');
    expect(markdownOfRow()).toBe('para ONE\n\npara TWO\n');
  });

  it('renames the page through the title file', async () => {
    const out = await exec(`echo 'New name' > ${pageDir}/title`);

    expect(out).toContain('renamed to "New name"');
    expect(store.updates[0]).toMatchObject({ title: 'New name' });
    expect(store.updates[0].editorData).toBeUndefined();
  });
  it('refuses an edit when the page was saved while the command ran', async () => {
    hooks.duringCommand = () => {
      store.row = { ...store.row, updatedAt: new Date('2026-01-02') };
    };

    const out = await exec(sed('para two', 'para TWO'));

    expect(out).toContain('Nothing was written: the page changed after this command read it');
    expect(store.updates).toHaveLength(0);
  });

  it('keeps node ids unique when another page loads while the command runs', async () => {
    // Stored ids 1-4: a new node must not take key 3 or 4.
    store.row = { ...store.row, editorData: pageData(['para one', 'para two']) };
    // Loading a page with stored ids resets Lexical's process-wide node counter (here to 3).
    hooks.duringCommand = () => {
      const other = createHeadlessEditor();
      other.hydrateEditorData(pageData(['x']), { keepId: true });
      other.destroy();
    };

    const out = await exec(
      `sed -i '0,/<\\/p>/s//<\\/p><p><span>inserted<\\/span><\\/p>/' ${pageDir}/doc.xml`,
    );

    expect(out).toContain('1 inserted');
    expect(markdownOfRow()).toBe('para one\n\ninserted\n\npara two\n');
    const ids = JSON.stringify(store.row.editorData).match(/"id":"[^"]+"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
