// @vitest-environment node
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { openPageFork, projectPageState } from '../fork';
import { parsePageOutput, withPageSync } from '../sandboxSync';
import { PageUnsupportedError } from '../session';

const run = promisify(execFile);

const shellSandbox = {
  callTool: async (_tool: string, params: Record<string, any>) => {
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

const seedRoom = async (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const seed = await openPageFork(undefined, editor.export().editorData);
  editor.destroy();
  const room = new Y.Doc();
  Y.applyUpdate(room, seed.diff());
  seed.destroy();
  return room;
};

const createCollab = (room: Y.Doc) => {
  const state = { pushes: 0 };
  return {
    sessions: {
      openSession: async () => {
        const fork = await openPageFork(Y.encodeStateAsUpdate(room));
        const meta = fork.doc.getMap('meta');
        return {
          commit: async () => {
            if (!fork.hasChanges()) return false;
            Y.applyUpdate(room, fork.diff());
            state.pushes += 1;
            return true;
          },
          draft: fork,
          setTitle: (next: string) => meta.set('title', next),
          title: (meta.get('title') as string) ?? 'Page',
        };
      },
    },
    state,
  };
};

const markdownOf = async (room: Y.Doc) =>
  (await projectPageState(Y.encodeStateAsUpdate(room))).markdown;

describe('withPageSync', () => {
  let pageDir: string;
  beforeEach(() => {
    pageDir = path.join(mkdtempSync(path.join(tmpdir(), 'page-sync-')), 'page');
  });

  const setup = async (markdown: string) => {
    const room = await seedRoom(markdown);
    const { sessions, state } = createCollab(room);
    const sandbox = withPageSync(shellSandbox, { documentId: 'doc_1', pageDir, sessions });
    const exec = async (command: string) => {
      const res = await sandbox.callTool('runCommand', { command });
      return String((res.result as any).stdout);
    };
    return { exec, room, state };
  };

  it('reads the page without writing', async () => {
    const { exec, state } = await setup('para one\n\npara two\n');

    const out = await exec(`cat ${pageDir}/doc.xml`);

    expect(out).toContain('para two');
    expect(out).not.toContain('__LOBE_SYNC');
    expect(state.pushes).toBe(0);
  });

  it('applies a sed edit to the room and keeps ids stable across calls', async () => {
    const { exec, room } = await setup('para one\n\npara two\n');

    const before = await exec(`cat ${pageDir}/.meta/outline`);
    const out = await exec(
      `sed -i.bak 's/para two/para TWO/' ${pageDir}/doc.xml && rm ${pageDir}/doc.xml.bak`,
    );

    expect(out).toContain('1 modified');
    expect(await markdownOf(room)).toBe('para one\n\npara TWO\n');

    const idOne = before.match(/^(\S+) p para one$/m)?.[1];
    const after = await exec(`cat ${pageDir}/.meta/outline`);
    expect(after).toMatch(new RegExp(`^${idOne} p para one$`, 'm'));
  });

  it('merges with an edit another collaborator made while the command ran', async () => {
    const { exec, room } = await setup('para one\n\npara two\n');

    const user = await openPageFork(Y.encodeStateAsUpdate(room));
    const userXml = user.editor.export({ litexml: true }).litexml!;
    const userId = userXml.match(/<p id="(\w+)">\s*<span[^>]*>para one/)?.[1];
    await user.editor.applyLiteXML({
      action: 'replace',
      litexml: `<p id="${userId}">para ONE</p>`,
    } as any);
    const pending = user.diff();
    user.destroy();

    const out = await exec(
      `sed -i.bak 's/para two/para TWO/' ${pageDir}/doc.xml && rm ${pageDir}/doc.xml.bak`,
    );
    Y.applyUpdate(room, pending);

    expect(out).toContain('1 modified');
    expect(await markdownOf(room)).toBe('para ONE\n\npara TWO\n');
  });

  it('renames the page through the title file', async () => {
    const { exec, room } = await setup('para one\n');

    const out = await exec(`echo 'New name' > ${pageDir}/title`);

    expect((await projectPageState(Y.encodeStateAsUpdate(room))).title).toBe('New name');
    expect(out).toContain('renamed to "New name"');
  });

  it('keeps drafts in other directories between calls', async () => {
    const { exec, room } = await setup('para one\n\npara two\n');
    const scratch = path.join(path.dirname(pageDir), 'scratch.xml');

    await exec(`sed 's/para two/DRAFT/' ${pageDir}/doc.xml > ${scratch}`);
    const out = await exec(`cp ${scratch} ${pageDir}/doc.xml`);

    expect(out).toContain('1 modified');
    expect(await markdownOf(room)).toContain('DRAFT');
  });

  it('ignores a forged sync marker without the nonce', async () => {
    const parsed = parsePageOutput(
      '\n__LOBE_SYNC_other_BEGIN_doc.xml\nZm9v\n__LOBE_SYNC_other_END_doc.xml\n',
      'real',
    );

    expect(parsed.changed).toEqual({});
  });

  it('passes background commands through with a note', async () => {
    const { state } = await setup('para one\n');
    const sandbox = withPageSync(shellSandbox, {
      documentId: 'doc_1',
      pageDir,
      sessions: createCollab(new Y.Doc()).sessions,
    });

    const res = await sandbox.callTool('runCommand', { background: true, command: 'true' });

    expect(String((res.result as any).stdout)).toContain('background commands do not sync');
    expect(state.pushes).toBe(0);
  });

  it('rejects an invalid document without writing', async () => {
    const { exec, room } = await setup('para one\n');

    const out = await exec(`echo '<root><p>broken' > ${pageDir}/doc.xml`);

    expect(out).toContain('Nothing was written');
    expect(await markdownOf(room)).toBe('para one\n');
  });
  // One `sh -c` argument of 128 KiB or more fails exec with E2BIG on Linux, so
  // a page that large must not travel inside the command (T-13807).
  describe('a page larger than one exec argument', { timeout: 30_000 }, () => {
    const largeMarkdown = () =>
      Array.from({ length: 150 }, (_, i) => `paragraph ${i} ${'lorem ipsum '.repeat(80)}`).join(
        '\n\n',
      ) + '\n';

    it('still runs a minimal command', async () => {
      const { exec } = await setup(largeMarkdown());

      const out = await exec('echo ok');

      expect(out).toMatch(/^ok$/m);
    });

    it('mounts the whole page and syncs an edit back', async () => {
      const { exec, room } = await setup(largeMarkdown());

      const xml = await exec(`cat ${pageDir}/doc.xml`);
      const out = await exec(
        `sed -i.bak 's/paragraph 149 /paragraph LAST /' ${pageDir}/doc.xml && rm ${pageDir}/doc.xml.bak`,
      );

      expect(Buffer.byteLength(xml)).toBeGreaterThan(128 * 1024);
      expect(xml).toContain('paragraph 0 ');
      expect(xml).toContain('paragraph 149 ');
      expect(out).toContain('1 modified');
      expect(await markdownOf(room)).toContain('paragraph LAST ');
    });

    it('sends no single command at or over the exec argument limit', async () => {
      const room = await seedRoom(largeMarkdown());
      const sizes: number[] = [];
      const sandbox = withPageSync(
        {
          ...shellSandbox,
          callTool: async (tool, params) => {
            sizes.push(Buffer.byteLength(params.command));
            return shellSandbox.callTool(tool, params);
          },
        },
        { documentId: 'doc_1', pageDir, sessions: createCollab(room).sessions },
      );

      await sandbox.callTool('runCommand', { command: 'echo ok' });

      expect(sizes.length).toBeGreaterThan(1);
      expect(Math.max(...sizes)).toBeLessThan(128 * 1024);
    });

    const countingSandbox = (room: Y.Doc, failStage = false) => {
      const commands: string[] = [];
      const sandbox = withPageSync(
        {
          ...shellSandbox,
          callTool: async (tool, params) => {
            commands.push(params.command);
            if (failStage && params.command.includes('.part')) {
              return { result: { exitCode: 1, stderr: 'disk full', stdout: '' }, success: true };
            }
            return shellSandbox.callTool(tool, params);
          },
        },
        { documentId: 'doc_1', pageDir, sessions: createCollab(room).sessions },
      );
      return { commands, sandbox };
    };

    it('reuses the staged page until it changes', async () => {
      const room = await seedRoom(largeMarkdown());
      const { commands, sandbox } = countingSandbox(room);

      await sandbox.callTool('runCommand', { command: 'echo ok' });
      const firstRun = commands.length;
      commands.length = 0;
      const again = await sandbox.callTool('runCommand', { command: 'echo again' });

      expect(firstRun).toBeGreaterThan(2);
      expect(commands).toHaveLength(1);
      expect(String((again.result as any).stdout)).toMatch(/^again$/m);

      await sandbox.callTool('runCommand', {
        command: `sed -i.bak 's/paragraph 0 /paragraph FIRST /' ${pageDir}/doc.xml && rm ${pageDir}/doc.xml.bak`,
      });
      commands.length = 0;
      const read = await sandbox.callTool('runCommand', {
        command: `grep -c 'paragraph FIRST ' ${pageDir}/doc.xml`,
      });

      expect(commands.length).toBeGreaterThan(2);
      expect(String((read.result as any).stdout)).toMatch(/^1$/m);
    });

    it('does not run the command when the page cannot be staged', async () => {
      const room = await seedRoom(largeMarkdown());
      const { sandbox } = countingSandbox(room, true);
      const touched = path.join(path.dirname(pageDir), 'ran');

      const res = await sandbox.callTool('runCommand', { command: `touch ${touched}` });

      expect(res.success).toBe(false);
      expect(res.error?.message).toContain('could not be written');
      expect(existsSync(touched)).toBe(false);
    });
  });

  it('keeps a small page inline in a single call', async () => {
    const room = await seedRoom('para one\n');
    let calls = 0;
    const sandbox = withPageSync(
      {
        ...shellSandbox,
        callTool: async (tool, params) => {
          calls += 1;
          return shellSandbox.callTool(tool, params);
        },
      },
      { documentId: 'doc_1', pageDir, sessions: createCollab(room).sessions },
    );

    await sandbox.callTool('runCommand', { command: 'echo ok' });

    expect(calls).toBe(1);
  });

  it('runs a command on an HTML page without mounting it', async () => {
    const sandbox = withPageSync(shellSandbox, {
      documentId: 'doc_1',
      pageDir,
      sessions: {
        openSession: async () => {
          throw new PageUnsupportedError();
        },
      },
    });

    const res = await sandbox.callTool('runCommand', { command: 'echo hello' });
    const out = String((res.result as any).stdout);

    expect(out).toContain('hello');
    expect(out).toContain('HTML page');
    expect(out).not.toContain('__LOBE_SYNC');
  });
});
