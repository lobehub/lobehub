// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { users } from '@/database/schemas';
import { TaskService } from '@/server/services/task';

import { createTaskRuntime } from './task';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));
vi.mock('@/server/routers/lambda/task', () => ({ taskRouter: { createCaller: vi.fn() } }));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const userId = 'task-view-comments-user';
const db: LobeChatDatabase = await getTestDB();

// A periodic task keeps its dedup ledger in a comment; the next round must read it back.
const ledger = [
  '## 去重台账',
  ...Array.from({ length: 60 }, (_, i) => `- #${1000 + i} 已处理（PR #${2000 + i}）`),
].join('\n');

describe('viewTask comment bodies (real PostgreSQL)', () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({ fullName: 'Arvin', id: userId });
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  it('returns stored comment bodies with author and time, and the full ledger by commentId', async () => {
    const taskModel = new TaskModel(db, userId);
    const task = await taskModel.create({ instruction: '每轮先读历史评论里的去重台账' });
    const comment = await taskModel.addComment({
      authorUserId: userId,
      content: ledger,
      taskId: task.id,
      userId,
    });
    const runtime = createTaskRuntime({
      agentModel: {} as never,
      taskCaller: {} as never,
      taskModel,
      taskService: new TaskService(db, userId),
    });

    const overview = await runtime.viewTask({ identifier: task.identifier });
    expect(overview.success).toBe(true);
    expect(overview.content).toContain(`👤 user Arvin  ${comment.id}`);
    expect(overview.content).toContain('      - #1000 已处理（PR #2000）');
    // The ledger is longer than the per-comment cap, so the overview says how to read the rest.
    expect(overview.content).toContain(`commentId: "${comment.id}" })]`);
    expect(overview.content).not.toContain('#1059');

    const full = await runtime.viewTask({ commentId: comment.id, identifier: task.identifier });
    expect(full.success).toBe(true);
    expect(full.content).toContain('Author: 👤 user Arvin');
    expect(full.content).toContain(`Time: ${comment.createdAt.toISOString()}`);
    expect(full.content).toContain(ledger);
  });
});
