import { describe, expect, it } from 'vitest';

import { parseTaskContent } from './parseTaskContent';

describe('parseTaskContent', () => {
  it('parses the basic task block from the screenshot', () => {
    const raw = `<hint>This tag contains the complete task context. Do NOT call viewTask to re-fetch it.</hint>
T-32 写一本《AI Agent 实战指南》
Status: ⭕ backlog     Priority: -
Instruction: 帮我写一本面向开发者的 AI Agent 技术书籍，涵盖基础概念、主流框架、实战案例。目标 8 章，每章 5000-8000 字。
请先制定大纲让我确认后再动笔。
Agent: agt_9GOn6nUgGw35

Review: (not configured)`;

    const parsed = parseTaskContent(raw);

    expect(parsed.identifier).toBe('T-32');
    expect(parsed.name).toBe('写一本《AI Agent 实战指南》');
    expect(parsed.statusIcon).toBe('⭕');
    expect(parsed.status).toBe('backlog');
    expect(parsed.priority).toBe('-');
    expect(parsed.instruction).toContain('帮我写一本面向开发者的 AI Agent 技术书籍');
    expect(parsed.instruction).toContain('请先制定大纲让我确认后再动笔。');
    expect(parsed.agent).toBe('agt_9GOn6nUgGw35');
    expect(parsed.review).toBe('(not configured)');
  });

  it('parses subtasks, activities, and workspace sections', () => {
    const raw = `T-1 Demo task
Status: ● running     Priority: high
Instruction: do the thing
Topics: 2

Subtasks:
  T-2 ✓ completed Subtask A
  T-3 ○ backlog Subtask B ← blocks: T-2

Workspace (1):
  📁 plans (doc-1)
    └── 📄 outline (doc-2)  120 chars

Activities:
  💬 1h ago Topic #1 Outline ✓ completed
  💭 30m ago 👤 user Looks good

Review: (not configured)`;

    const parsed = parseTaskContent(raw);

    expect(parsed.identifier).toBe('T-1');
    expect(parsed.name).toBe('Demo task');
    expect(parsed.subtasks).toHaveLength(2);
    expect(parsed.subtasks?.[0]).toContain('T-2');
    expect(parsed.workspace).toHaveLength(2);
    expect(parsed.activities).toHaveLength(2);
    expect(parsed.review).toBe('(not configured)');
  });

  it('captures rubrics when review is configured', () => {
    const raw = `T-1 Demo
Status: ○ backlog     Priority: -
Instruction: x

Review (maxIterations: 3):
  - clarity [llm] ≥ 80%
  - depth [llm]`;

    const parsed = parseTaskContent(raw);

    expect(parsed.review).toBe('Review (maxIterations: 3):');
    expect(parsed.reviewRubrics).toEqual(['clarity [llm] ≥ 80%', 'depth [llm]']);
  });

  it('captures parentTask block', () => {
    const raw = `T-2 sub
Status: ○ backlog     Priority: -
Instruction: child task

<parentTask identifier="T-1" name="parent">
  Instruction: parent goal
</parentTask>`;

    const parsed = parseTaskContent(raw);

    expect(parsed.parentTaskBlock).toContain('<parentTask identifier="T-1"');
    expect(parsed.parentTaskBlock).toContain('</parentTask>');
  });
});
