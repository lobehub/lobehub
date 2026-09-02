import { describe, expect, it } from 'vitest';

import {
  buildTaskRunPrompt,
  formatTaskCreated,
  formatTaskDetail,
  formatTasksCreated,
  formatWorkspaceMembers,
  taskDetailHref,
  taskRef,
} from './index';

// Fixed reference time for stable timeAgo output
const NOW = new Date('2026-03-22T12:00:00Z');

const baseTask = { id: 'task_test', status: 'running' };

describe('task deep-links', () => {
  it('taskDetailHref returns a relative path without baseUrl', () => {
    expect(taskDetailHref('T-198')).toBe('/task/T-198');
  });

  it('taskDetailHref returns an absolute url with baseUrl (and strips trailing slash)', () => {
    expect(taskDetailHref('T-198', 'https://app.lobehub.com')).toBe(
      'https://app.lobehub.com/task/T-198',
    );
    expect(taskDetailHref('T-198', 'https://app.lobehub.com/')).toBe(
      'https://app.lobehub.com/task/T-198',
    );
  });

  it('taskRef renders a markdown link', () => {
    expect(taskRef('T-199')).toBe('[T-199](/task/T-199)');
    expect(taskRef('T-199', 'https://app.lobehub.com')).toBe(
      '[T-199](https://app.lobehub.com/task/T-199)',
    );
  });

  it('formatTaskCreated links identifier + parent, absolute when baseUrl is given (IM/bot)', () => {
    const out = formatTaskCreated({
      baseUrl: 'https://app.lobehub.com',
      identifier: 'T-198',
      instruction: 'do it',
      name: 'Parent task',
      parentLabel: 'T-100',
      priority: 2,
      status: 'backlog',
    });
    expect(out).toContain(
      'Task created: [T-198](https://app.lobehub.com/task/T-198) "Parent task"',
    );
    expect(out).toContain('Parent: [T-100](https://app.lobehub.com/task/T-100)');
  });

  it('formatTasksCreated renders a header + linked lines (relative without baseUrl)', () => {
    const out = formatTasksCreated([
      { identifier: 'T-1', name: 'A', success: true },
      { identifier: 'T-2', name: 'B', success: true },
    ]);
    expect(out).toBe(
      [
        'Created 2 tasks:',
        '1. [T-1](/task/T-1) "A" — created',
        '2. [T-2](/task/T-2) "B" — created',
      ].join('\n'),
    );
  });

  it('formatTasksCreated uses absolute links with baseUrl and reports failures', () => {
    const out = formatTasksCreated(
      [
        { identifier: 'T-1', name: 'A', success: true },
        { error: 'boom', name: 'B', success: false },
      ],
      'https://app.lobehub.com',
    );
    expect(out).toContain('Created 1/2 tasks (1 failed):');
    expect(out).toContain('1. [T-1](https://app.lobehub.com/task/T-1) "A" — created');
    expect(out).toContain('2. "B" — failed: boom');
  });
});

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

  it('should render a heartbeat automation line with the interval and a no-terminal warning', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          ...baseTask,
          automationMode: 'heartbeat',
          heartbeatInterval: 14_400,
          identifier: 'TASK-1',
          instruction: '每 4 小时监听 Discord 频道',
          name: 'Discord 监听',
        },
      },
      NOW,
    );

    expect(result).toContain('Automation: heartbeat, every 4h');
    expect(result).toContain('NEVER set this task to completed');
  });

  it('should render a schedule automation line with the cron pattern and timezone', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          ...baseTask,
          automationMode: 'schedule',
          identifier: 'TASK-1',
          instruction: '每天早上汇总',
          name: '每日汇总',
          schedulePattern: '0 9 * * *',
          scheduleTimezone: 'Asia/Shanghai',
        },
      },
      NOW,
    );

    expect(result).toContain('Automation: cron "0 9 * * *" (Asia/Shanghai)');
    expect(result).toContain('NEVER set this task to completed');
  });

  it('should not render an automation line for non-automation tasks', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '一次性任务',
          name: '一次性任务',
        },
      },
      NOW,
    );

    expect(result).not.toContain('Automation:');
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

  it('should render the verify delivery-acceptance section with criteria and evidence', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          id: 'task_root',
          identifier: 'TASK-1',
          instruction: 'ship the feature',
          status: 'running',
          verify: {
            criteria: [
              {
                required: true,
                requiredEvidence: [{ hint: 'full page', type: 'screenshot' }],
                title: 'login page renders',
              },
              { required: false, title: 'console is clean' },
            ],
            enabled: true,
            maxIterations: 2,
            requirement: 'the login flow works end to end',
          },
        },
      },
      NOW,
    );

    expect(result).toContain('Verify — delivery acceptance (maxIterations: 2)');
    expect(result).toContain('Requirement: the login flow works end to end');
    expect(result).toContain('login page renders (required)');
    expect(result).toContain('· evidence: screenshot — full page');
    expect(result).toContain('console is clean');
    expect(result).toContain('include artifact paths, commands, and observed results');
    expect(result).toContain('an independent verifier decides whether this Task is complete');
    expect(result).not.toContain('lh acceptance run result submit');
  });

  it('should omit the verify section when verify is disabled', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          id: 'task_root',
          identifier: 'TASK-1',
          instruction: 'ship the feature',
          status: 'running',
          verify: { criteria: [{ title: 'x' }], enabled: false, requirement: 'r' },
        },
      },
      NOW,
    );

    expect(result).not.toContain('Verify — delivery acceptance');
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

  it('renders the goal loop section with reject comment, failed checks and CLI hint', () => {
    const result = buildTaskRunPrompt(
      {
        goalLoop: {
          failedChecks: [
            { title: 'LCP < 2s', why: 'measured 2.8s — preload hero image' },
            { title: 'Lighthouse ≥ 90' },
          ],
          maxRounds: 3,
          rejectComment: '真机 LCP 还是 2.4s,按真机口径再优化',
          round: 2,
        },
        task: {
          ...baseTask,
          identifier: 'TASK-1',
          instruction: '官网首页改版并上线',
          name: '首页改版',
        },
      },
      NOW,
    );

    expect(result).toContain('Goal loop — round 2 of 3');
    // Reject comment outranks the failed checks.
    expect(result.indexOf('真机 LCP 还是 2.4s')).toBeLessThan(result.indexOf('LCP < 2s'));
    expect(result).toContain('1. LCP < 2s — measured 2.8s — preload hero image');
    expect(result).toContain('2. Lighthouse ≥ 90');
    expect(result).toContain('`lh task topic view TASK-1 <seq>`');
  });

  it('omits the round budget suffix for uncapped goals', () => {
    const result = buildTaskRunPrompt(
      {
        goalLoop: { maxRounds: null, round: 5 },
        task: { ...baseTask, identifier: 'TASK-1', instruction: '写书', name: '写一本书' },
      },
      NOW,
    );

    expect(result).toContain('Goal loop — round 5:');
    expect(result).not.toContain('round 5 of');
  });

  it('expands full handoff for the two most recent rounds and keeps older ones title-only', () => {
    const mkTopic = (seq: number, summary: string) => ({
      createdAt: `2026-03-2${seq}T10:00:00Z`,
      handoff: {
        keyFindings: [`finding-${seq}`],
        nextAction: `next-${seq}`,
        summary,
        title: `round ${seq}`,
      },
      id: `t${seq}`,
      seq,
      status: 'completed',
    });
    const result = buildTaskRunPrompt(
      {
        activities: {
          topics: [
            mkTopic(1, 'summary-one'),
            mkTopic(2, 'summary-two'),
            mkTopic(3, 'summary-three'),
          ],
        },
        task: { ...baseTask, identifier: 'TASK-1', instruction: '写书', name: '写一本书' },
      },
      NOW,
    );

    // Recent two rounds carry the full handoff…
    expect(result).toContain('↳ summary: summary-two');
    expect(result).toContain('↳ summary: summary-three');
    expect(result).toContain('↳ findings: finding-3');
    expect(result).toContain('↳ next: next-3');
    // …the oldest stays title-only.
    expect(result).not.toContain('summary-one');
    expect(result).toContain('round 1');
  });
});

describe('human assignee formatting', () => {
  it('formatTaskCreated surfaces the member assignee when present', () => {
    const base = { identifier: 'T-1', instruction: 'do it', name: 'Task', status: 'backlog' };
    expect(formatTaskCreated({ ...base, assigneeLabel: 'Alice (usr_2)' })).toContain(
      '  Assignee: Alice (usr_2)',
    );
    expect(formatTaskCreated(base)).not.toContain('Assignee:');
  });

  it('formatTaskDetail lists the member assignee (detail.userId) next to the agent', () => {
    const out = formatTaskDetail({
      agentId: null,
      identifier: 'T-1',
      instruction: 'do it',
      status: 'backlog',
      userId: 'usr_2',
    });
    expect(out).toContain('Assignee (member): usr_2');
    expect(out).not.toContain('Agent:');
  });

  it('formatWorkspaceMembers renders one line per member with the id to pass back', () => {
    const out = formatWorkspaceMembers([
      { id: 'usr_1', isSelf: true, name: 'Me', role: 'owner', username: 'me' },
      { id: 'usr_2', name: 'Alice Chen', role: 'member', username: 'alice' },
      { id: 'usr_3', username: 'bob' },
    ]);
    expect(out).toContain('Workspace members that can be assigned tasks (3)');
    expect(out).toContain('- Me  @me  role=owner  (you)  id=usr_1');
    expect(out).toContain('- Alice Chen  @alice  role=member  id=usr_2');
    // No display name → the username stands in, and is not repeated as @handle.
    expect(out).toContain('- bob  id=usr_3');
  });

  it('formatWorkspaceMembers surfaces email and linked IM identities for exact matching', () => {
    const out = formatWorkspaceMembers([
      {
        email: 'alice@lobehub.com',
        id: 'usr_2',
        imAccounts: ['discord:@Neko(4521)', 'slack:U123'],
        name: 'Alice Chen',
        role: 'member',
        username: 'alice',
      },
    ]);
    expect(out).toContain(
      '- Alice Chen  @alice  alice@lobehub.com  role=member  im=discord:@Neko(4521),slack:U123  id=usr_2',
    );
  });

  it('formatWorkspaceMembers announces a capped or filtered directory', () => {
    const alice = { id: 'usr_2', name: 'Alice Chen', role: 'member', username: 'alice' };
    expect(formatWorkspaceMembers([alice], { inWorkspace: true, total: 3 })).toContain(
      'Workspace members that can be assigned tasks (1 of 3 — pass query to narrow).',
    );
    expect(
      formatWorkspaceMembers([alice], { inWorkspace: true, query: 'ali', total: 1 }),
    ).toContain('Workspace members that can be assigned tasks matching "ali" (1).');
    expect(formatWorkspaceMembers([], { inWorkspace: true, query: 'zed', total: 0 })).toBe(
      'No workspace members match "zed". Try a different name, @handle, email or platform id.',
    );
  });

  it('formatWorkspaceMembers explains personal mode and empty results', () => {
    expect(
      formatWorkspaceMembers([{ id: 'usr_1', isSelf: true, name: 'Me' }], { inWorkspace: false }),
    ).toContain('Not in a workspace — the only person a task can be assigned to is you:');
    expect(formatWorkspaceMembers([], { inWorkspace: false })).toContain(
      'tasks can only be assigned to agents here',
    );
    expect(formatWorkspaceMembers([])).toBe('No workspace members can be assigned tasks.');
  });
});
