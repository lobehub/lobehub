import { describe, expect, it } from 'vitest';

import { buildTaskRunPrompt } from './index';

// Fixed reference time for stable timeAgo output
const NOW = new Date('2026-03-22T12:00:00Z');

const baseTask = { id: 'task_test', status: 'running' };

describe('buildTaskRunPrompt', () => {
  it('should build prompt with only task instruction', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '帮我写一本 AI Agent 技术书籍',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
  });

  it('should build prompt with task description + instruction', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          ...baseTask,
          description: '面向开发者的技术书籍',
          identifier: 'TASK-1',
          instruction: '帮我写一本 AI Agent 技术书籍，目标 8 章',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
  });

  it('should prioritize user feedback at the top', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            { content: '第2章改为先上手再讲原理', createdAt: '2026-03-22T10:00:00Z' },
            { content: '增加评测章节', createdAt: '2026-03-22T10:30:00Z' },
          ],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify feedback comes before task
    const feedbackIdx = result.indexOf('<user_feedback>');
    const taskIdx = result.indexOf('<task');
    expect(feedbackIdx).toBeLessThan(taskIdx);
  });

  it('should include agent comments with author label and time', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            {
              agentId: 'agt_xxx',
              content: '大纲已完成，请确认',
              createdAt: '2026-03-22T09:00:00Z',
            },
            { content: '确认，开始写', createdAt: '2026-03-22T10:00:00Z' },
          ],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('🤖 agent');
    expect(result).toContain('👤 user');
    expect(result).toContain('3h ago');
    expect(result).toContain('2h ago');
  });

  it('should place high_priority_instruction first, then feedback', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [{ content: '用户反馈', createdAt: '2026-03-22T11:00:00Z' }],
        },
        extraPrompt: '这次重点关注第3章',
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    const feedbackIdx = result.indexOf('<user_feedback>');
    const extraIdx = result.indexOf('<high_priority_instruction>');
    const taskIdx = result.indexOf('<task');
    expect(extraIdx).toBeLessThan(feedbackIdx);
    expect(feedbackIdx).toBeLessThan(taskIdx);
  });

  it('should include activity history with topics and briefs in CLI style', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:05:00Z',
              id: 'brief_abc123',
              priority: 'urgent',
              resolvedAction: 'approve',
              resolvedAt: '2026-03-21T17:30:00Z',
              summary: '8章大纲已制定完成',
              title: '大纲完成',
              type: 'decision',
            },
            {
              createdAt: '2026-03-21T18:00:00Z',
              id: 'brief_def456',
              priority: 'normal',
              resolvedAt: null,
              summary: '第4章内容过多，建议拆分',
              title: '建议拆分第4章',
              type: 'decision',
            },
          ],
          topics: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              handoff: { summary: '完成了大纲制定' },
              id: 'tpc_aaa',
              seq: 1,
              status: 'completed',
              title: '制定大纲',
            },
            {
              createdAt: '2026-03-21T17:31:00Z',
              handoff: { summary: '修订了大纲并拆分子任务' },
              id: 'tpc_bbb',
              seq: 2,
              status: 'completed',
              title: '修订大纲',
            },
          ],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify timeline is sorted chronologically (oldest first)
    // Data: topic1(17:00), brief1(17:05), topic2(17:31), brief2(18:00)
    const taskSection = result.match(/<task>[\s\S]*<\/task>/)?.[0] || '';
    const topic1Idx = taskSection.indexOf('Topic #1');
    const brief1Idx = taskSection.indexOf('brief_abc123');
    const topic2Idx = taskSection.indexOf('Topic #2');
    const brief2Idx = taskSection.indexOf('brief_def456');
    expect(topic1Idx).toBeLessThan(brief1Idx);
    expect(brief1Idx).toBeLessThan(topic2Idx);
    expect(topic2Idx).toBeLessThan(brief2Idx);
  });

  it('should show resolved action and comment on briefs', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              resolvedAction: 'feedback',
              resolvedAt: '2026-03-21T18:00:00Z',
              resolvedComment: '第2章需要更多实例',
              summary: '第2章初稿完成',
              title: '第2章完成',
              type: 'result',
            },
          ],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-2',
          instruction: '写第2章',
          name: '第2章',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('第2章需要更多实例');
  });

  it('should handle full scenario with all sections', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:05:00Z',
              id: 'brief_001',
              resolvedAction: 'approve',
              resolvedAt: '2026-03-21T17:30:00Z',
              summary: '大纲已完成',
              title: '大纲完成',
              type: 'decision',
            },
          ],
          comments: [
            { content: '第5章后移，增加评测章节', createdAt: '2026-03-22T09:00:00Z' },
            { agentId: 'agt_inbox', content: '已调整大纲', createdAt: '2026-03-22T09:05:00Z' },
          ],
          topics: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              handoff: { summary: '完成大纲' },
              id: 'tpc_001',
              seq: 1,
              status: 'completed',
              title: '制定大纲',
            },
          ],
        },
        extraPrompt: '这次直接开始写第1章',
        task: {
          ...baseTask,
          description: '面向开发者的 AI Agent 技术书籍',
          identifier: 'TASK-1',
          instruction: '写一本 AI Agent 书，目标 8 章',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();

    // Verify order: instruction → feedback → task (activities now inside task)
    const tags = ['<high_priority_instruction>', '<user_feedback>', '<task>'];
    let lastIdx = -1;
    for (const tag of tags) {
      const idx = result.indexOf(tag);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('should handle empty activities gracefully', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [],
          comments: [],
          topics: [],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).not.toContain('<user_feedback>');
    expect(result).not.toContain('<activities>');
  });

  it('should include subtasks in task section', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          id: 'task_root',
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
          status: 'running',
          subtasks: [
            { identifier: 'TASK-2', name: '第1章 Agent 概述', priority: 3, status: 'completed' },
            {
              blockedBy: 'TASK-2',
              identifier: 'TASK-3',
              name: '第2章 快速上手',
              priority: 3,
              status: 'backlog',
            },
          ],
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('TASK-2');
    expect(result).toContain('TASK-3');
    expect(result).toContain('← blocks: TASK-2');
  });

  it('should truncate comments to 80 chars in activities but keep full in user_feedback', () => {
    const longContent = 'A'.repeat(90) + ' — this part should be truncated in activities';
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [{ content: longContent, createdAt: '2026-03-22T11:00:00Z' }],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // user_feedback should have full content
    const feedbackSection = result.split('<user_feedback>')[1]?.split('</user_feedback>')[0] || '';
    expect(feedbackSection).toContain(longContent);
    // activities comment should be truncated
    const taskSection = result.match(/<task>[\s\S]*<\/task>/)?.[0] || '';
    expect(taskSection).toContain('...');
    expect(taskSection).not.toContain(longContent);
  });

  it('should include subtasks in task tag when provided', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          id: 'task_001',
          identifier: 'TASK-1',
          instruction: '写一本 AI Agent 书，目标 8 章',
          name: '写一本书',
          status: 'running',
          subtasks: [
            { identifier: 'TASK-2', name: '第1章 AI Agent 概述', priority: 3, status: 'running' },
            { identifier: 'TASK-3', name: '第2章 核心架构', priority: 3, status: 'backlog' },
            { identifier: 'TASK-4', name: '第3章 手写 Agent', priority: 2, status: 'backlog' },
          ],
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify subtasks appear between <task> and </task>
    const taskMatch = result.match(/<task>[\s\S]*<\/task>/)?.[0] || '';
    expect(taskMatch).toContain('Subtasks:');
    expect(taskMatch).toContain('TASK-2');
    expect(taskMatch).toContain('TASK-3');
    expect(taskMatch).toContain('TASK-4');
    // Verify hint is present
    expect(taskMatch).toContain('Do NOT call viewTask');
  });

  it('should include parentTask context for subtasks', () => {
    const result = buildTaskRunPrompt(
      {
        parentTask: {
          identifier: 'TASK-1',
          instruction: '写一本 AI Agent 书，目标 8 章',
          name: '写一本书',
          subtasks: [
            { identifier: 'TASK-2', name: '第1章 概述', priority: 3, status: 'completed' },
            {
              blockedBy: 'TASK-2',
              identifier: 'TASK-4',
              name: '第2章 核心架构',
              priority: 3,
              status: 'running',
            },
            {
              blockedBy: 'TASK-4',
              identifier: 'TASK-6',
              name: '第3章 手写 Agent',
              priority: 2,
              status: 'backlog',
            },
          ],
        },
        task: {
          id: 'task_004',
          identifier: 'TASK-4',
          instruction: '撰写第2章',
          name: '第2章 核心架构',
          parentIdentifier: 'TASK-1',
          status: 'running',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify parentTask block exists inside <task>
    const taskSection = result.match(/<task>[\s\S]*<\/task>/)?.[0] || '';
    expect(taskSection).toContain('<parentTask');
    expect(taskSection).toContain('TASK-1');
    expect(taskSection).toContain('写一本 AI Agent 书');
    // Current task should be marked
    expect(taskSection).toContain('TASK-4');
    expect(taskSection).toContain('◀ current');
    // Dependency info
    expect(taskSection).toContain('← blocks: TASK-2');
    expect(taskSection).toContain('← blocks: TASK-4');
  });

  it('should only include user comments in user_feedback, not agent comments', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            { content: '用户反馈', createdAt: '2026-03-22T10:00:00Z' },
            { agentId: 'agt_xxx', content: 'Agent 回复', createdAt: '2026-03-22T10:05:00Z' },
          ],
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    const feedbackSection = result.split('<user_feedback>')[1]?.split('</user_feedback>')[0] || '';
    expect(feedbackSection).toContain('用户反馈');
    expect(feedbackSection).not.toContain('Agent 回复');
    // But activities should have both
    const taskSection = result.match(/<task>[\s\S]*<\/task>/)?.[0] || '';
    expect(taskSection).toContain('👤 user');
    expect(taskSection).toContain('🤖 agent');
  });
});
