// @vitest-environment node
import { createHook } from 'node:async_hooks';

import { PageChangedDuringCommandError, runPageBash } from '@lobechat/builtin-tool-page-agent/bash';
import { EditorRuntime } from '@lobechat/editor-runtime';
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { describe, expect, it } from 'vitest';

const setup = (markdown: string, initialTitle = 'Old Title') => {
  const headless = createHeadlessEditor();
  if (markdown) headless.hydrateMarkdown(markdown, { keepId: true });
  let title = initialTitle;

  const runtime = new EditorRuntime();
  runtime.setEditor(headless.kernel as unknown as Parameters<EditorRuntime['setEditor']>[0]);
  runtime.setTitleHandlers(
    (next) => {
      title = next;
    },
    () => title,
  );

  return {
    getTitle: () => title,
    setTitle: (next: string) => {
      title = next;
    },
    runtime,
    markdown: () => headless.export().markdown.trim(),
    run: (command: string) => runPageBash(runtime, command),
  };
};

describe('runPageBash', () => {
  it.each(['title', 'page'])(
    'does not rename after %s changes while the body is saved',
    async (change) => {
      const page = setup('body');
      page.runtime.setCurrentDocId('original');
      page.runtime.setAfterMutateHandler(async () => {
        // The real client hook waits for a network save before editTitle runs.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (change === 'title') page.setTitle('User title');
        else page.runtime.setCurrentDocId('another-page');
      });

      await expect(
        page.run("sed -i 's/body/BODY/' /doc.xml; echo 'Agent title' > /title"),
      ).rejects.toThrow(/body changes.*review.*title.*not/i);
      expect(page.markdown()).toBe('BODY');
      expect(page.getTitle()).toBe(change === 'title' ? 'User title' : 'Old Title');
    },
  );

  it('rechecks after an asynchronous pre-mutation hook', async () => {
    const page = setup('body');
    page.runtime.setBeforeMutateHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      page.setTitle('User title');
    });

    await expect(page.run("sed -i 's/body/BODY/' /doc.xml")).rejects.toBeInstanceOf(
      PageChangedDuringCommandError,
    );
    expect(page.markdown()).toBe('body');
  });
  it('reads the page without changing it', async () => {
    const page = setup('para one\n\npara two\n');

    const { content, state } = await page.run('cat /doc.xml');

    expect(content).toContain('para two');
    expect(state.changed).toBe(false);
    expect(state.exitCode).toBe(0);
  });

  it('does not expose a markdown copy of the page', async () => {
    const page = setup('para one\n');

    const { state } = await page.run('ls /doc.md');

    expect(state.exitCode).not.toBe(0);
  });

  it('ignores a /doc.md written by the command', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run("echo '# New' > /doc.md");

    expect(state.changed).toBe(false);
    expect(page.markdown()).toBe('para one');
    expect(content).toContain('/doc.md');
  });

  it('lists top-level blocks in the outline', async () => {
    const page = setup('# Heading\n\npara one\n');

    const { content } = await page.run('cat /.meta/outline');

    expect(content).toMatch(/^\w{4} h1 Heading$/m);
    expect(content).toMatch(/^\w{4} p para one$/m);
  });

  it('applies an in-place edit of /doc.xml', async () => {
    const page = setup('para one\n\npara two\n');

    const { content, state } = await page.run("sed -i 's/para two/para TWO/' /doc.xml");

    expect(state.changed).toBe(true);
    expect(page.markdown()).toBe('para one\n\npara TWO');
    expect(content).toContain('1 modified');
  });

  it('commits file changes even when the command exits non-zero', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run("sed -i 's/one/ONE/' /doc.xml && false");

    expect(state.changed).toBe(true);
    expect(state.exitCode).toBe(1);
    expect(page.markdown()).toBe('para ONE');
    expect(content).toContain('exit 1');
  });

  it('renames the page when /title is written', async () => {
    const page = setup('body\n');

    const { state } = await page.run("echo 'New Title' > /title");

    expect(state.changed).toBe(true);
    expect(page.getTitle()).toBe('New Title');
  });

  it('rejects an empty title', async () => {
    const page = setup('body\n');

    const { content, state } = await page.run(': > /title');

    expect(state.changed).toBe(false);
    expect(page.getTitle()).toBe('Old Title');
    expect(content).toMatch(/title/i);
  });

  it('rejects a malformed /doc.xml without touching the page', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run("echo '<root><p>broken</root>' > /doc.xml");

    expect(state.changed).toBe(false);
    expect(page.markdown()).toBe('para one');
    expect(content).toMatch(/not written|nothing was written/i);
  });

  it('stubs interpreters with exit 127', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run('python3 -c "print(1)"');

    expect(state.exitCode).toBe(127);
    expect(content).toContain('not available');
  });

  it('warns about files written outside /tmp and ignores them', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run('echo hi > /notes.txt; echo ok > /tmp/scratch');

    expect(state.changed).toBe(false);
    expect(content).toContain('/notes.txt');
    expect(content).not.toContain('/tmp/scratch');
  });

  it('writes nothing when the command hits an execution limit', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run(
      "sed -i 's/one/ONE/' /doc.xml; while true; do :; done",
    );

    expect(state.changed).toBe(false);
    expect(page.markdown()).toBe('para one');
    expect(content).toMatch(/nothing was written/i);
  });

  it('rejects blocks appended after </root>', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run("printf '<p>two</p>\\n' >> /doc.xml");

    expect(state.changed).toBe(false);
    expect(content).toMatch(/nothing was written/i);
  });

  it('points an edit of an empty page at the initPage tool', async () => {
    const page = setup('');

    const { content, state } = await page.run("echo '<root><p>hello</p></root>' > /doc.xml");

    expect(state.changed).toBe(false);
    expect(content).toContain('initPage');
  });

  it('rejects a rewrite that grows the page far beyond its size', async () => {
    const page = setup('para one\n');

    const { content, state } = await page.run(
      "echo 0123456789 > /tmp/a; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do sed -i 's/.*/&&/' /tmp/a; done; cp /tmp/a /doc.xml",
    );

    expect(state.changed).toBe(false);
    expect(content).toMatch(/too large/i);
  });

  it('keeps command output out of the tool state', async () => {
    const page = setup('para one\n');

    const { state } = await page.run('cat /doc.xml');

    expect(state).not.toHaveProperty('output');
  });

  it('lets host async hooks read timers while a command executes', async () => {
    const page = setup('para one\n');
    const errors: unknown[] = [];
    // Next.js installs an async hook that reads performance.now for every new
    // promise; a throw from inside an async hook kills the whole process.
    const hook = createHook({
      init() {
        try {
          performance.now();
        } catch (error) {
          errors.push(error);
        }
      },
    }).enable();

    const { state } = await page.run('cat /doc.xml');
    hook.disable();

    expect(errors).toEqual([]);
    expect(state.exitCode).toBe(0);
  });

  it('decodes non-ASCII text written through a redirect as UTF-8', async () => {
    const page = setup('café price $10 for alice\n');

    await page.run(
      `awk '{gsub(/\\$10/, "\\xe2\\x82\\xac70"); gsub(/alice/, "张三"); print}' /doc.xml > /tmp/n && cp /tmp/n /doc.xml`,
    );

    expect(page.markdown()).toBe('café price €70 for 张三');
  });

  it('refuses to write when the page changed while the command ran', async () => {
    const page = setup('para one\n\npara two\n');
    const read = page.runtime.getPageContentContext.bind(page.runtime);
    let reads = 0;
    page.runtime.getPageContentContext = (format) => {
      reads += 1;
      const context = read(format);
      return reads === 1 ? context : { ...context, xml: context.xml!.replace('para two', 'typed') };
    };

    await expect(page.run("sed -i 's/para one/para ONE/' /doc.xml")).rejects.toBeInstanceOf(
      PageChangedDuringCommandError,
    );
    expect(page.markdown()).toBe('para one\n\npara two');
  });

  it('refuses to write when the editor went away while the command ran', async () => {
    const page = setup('para one\n');
    const read = page.runtime.getPageContentContext.bind(page.runtime);
    let reads = 0;
    page.runtime.getPageContentContext = (format) => {
      reads += 1;
      if (reads > 1) throw new Error('Editor not initialized.');
      return read(format);
    };

    await expect(page.run("sed -i 's/one/ONE/' /doc.xml")).rejects.toBeInstanceOf(
      PageChangedDuringCommandError,
    );
  });
});
