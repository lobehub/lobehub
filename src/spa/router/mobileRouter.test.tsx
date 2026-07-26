import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readMobileRouterSource = () =>
  readFile(path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'), 'utf8');

describe('mobileRouter task routes', () => {
  it('registers task list and detail routes under the shared workspace layout', async () => {
    const source = await readMobileRouterSource();

    expect(source).toContain("import('@/routes/(main)/(task-workspace)/_layout')");
    expect(source).toContain("import('@/routes/(main)/tasks')");
    expect(source).toContain("import('@/routes/(main)/task/[taskId]')");
    expect(source).toContain("import('@/routes/(main)/agent/task/[taskId]')");
    expect(source).toContain("path: 'tasks'");
    expect(source).toContain("path: 'task'");
    expect(source).toContain("path: ':taskId'");
    expect(source).toContain("path: ':aid/task/:taskId'");
    expect(source).not.toContain("import('@/routes/(main)/tasks/_layout')");
  });

  it('reuses one chat element for agent index and topic routes', async () => {
    const source = await readMobileRouterSource();

    expect(source).toContain(
      "const mobileChatElement = dynamicElement(() => import('@/routes/(mobile)/chat'), 'Mobile > Chat');",
    );
    expect(source.match(/element:\s*mobileChatElement/g)).toHaveLength(2);
    expect(source.match(/import\('@\/routes\/\(mobile\)\/chat'\)/g)).toHaveLength(1);
  });
});
