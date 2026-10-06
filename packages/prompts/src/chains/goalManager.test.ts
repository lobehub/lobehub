import { describe, expect, it } from 'vitest';

import { buildGoalManagerPrompt, GOAL_MANAGER_PROMPT_VERSION } from './goalManager';

const base = {
  earlierFeedback: [],
  goalId: 'goal_1',
  maxTurns: 12,
  newFeedback: [],
  omittedFeedback: { earlier: 0, new: 0 },
  requirement: 'Find the training scheme closest to my rejections',
  token: 't',
  turn: 1,
};

/** The text of one CDATA element, or undefined when absent. */
const cdataOf = (prompt: string, tag: string) =>
  new RegExp(String.raw`<${tag}\b[^>]*><!\[CDATA\[\n([\S\s]*?)\n\]\]></${tag}>`).exec(prompt)?.[1];

/** Everything before the contract, which mentions element names in prose. */
const turnPart = (prompt: string) => prompt.slice(0, prompt.indexOf('<instruction>'));

describe('buildGoalManagerPrompt', () => {
  it.each([
    '探索怎样从用户历史数据提炼领域判断力',
    'Explore personal predictions from past decisions',
  ])(
    'keeps supervision language tied to the goal rather than the English control prompt: %s',
    (requirement) => {
      const prompt = buildGoalManagerPrompt({ ...base, requirement });
      expect(GOAL_MANAGER_PROMPT_VERSION).toBe('v7');
      expect(cdataOf(prompt, 'requirement')).toBe(requirement);
      expect(prompt).toContain('Use the language of the Goal requirement');
      expect(prompt).toContain(
        'progress updates, summaries, plan reasons, Task titles and descriptions',
      );
      expect(prompt).toContain(
        'Keep CLI commands, JSON keys, identifiers and literal tool output unchanged',
      );
      expect(prompt).toContain(
        'even when earlier conversation turns or tool results are in English',
      );
    },
  );

  /**
   * Regression: a takeover turn has to know what it is taking over. Without the
   * problem the coordinator hands over, the main Agent reads an ordinary planning
   * turn and re-plans work that is already in flight.
   */
  it('states the handed-over problem and the answers that move the goal', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      problem: 'Task attempt budget was exhausted',
    });
    expect(prompt).toContain('trigger="takeover"');
    expect(cdataOf(prompt, 'problem')).toBe('Task attempt budget was exhausted');
    expect(prompt).toContain('this Goal stops on a person');
    expect(prompt).toContain('escalate with the specific question');
  });

  /**
   * Regression: without dependsOn every planned task hung directly off the
   * problem node, so a four-round Goal rendered as one flat row.
   */
  it('asks each planned task to declare what it builds on', () => {
    const prompt = buildGoalManagerPrompt(base);
    expect(prompt).toContain('"dependsOn":["task node ID from an earlier round", 0]');
    expect(prompt).toContain('Never depend on a retired or rejected node');
  });

  it('says nothing about a takeover on an ordinary planning turn', () => {
    const prompt = buildGoalManagerPrompt(base);
    expect(prompt).toContain('trigger="first"');
    expect(turnPart(prompt)).not.toContain('<problem');
    expect(prompt).not.toContain('Takeover:');
  });

  /**
   * Regression: every turn resent the same contract and the last 20 comments as
   * one JSON blob, so the management conversation showed identical 5 KB messages
   * and a reader could not tell what a given turn was asked to act on. The turn
   * is now one block the client renders as a card.
   */
  it('emits one goalTurn block that separates new feedback from what the last turn had', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      earlierFeedback: [
        {
          author: 'user',
          content: 'Old note that the previous turn already handled.\nSecond line.',
          taskId: 'task_old',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      newFeedback: [
        {
          author: 'agent agt_1',
          content: 'Baseline is wrong; fix it before prediction.',
          taskId: 'task_new',
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      previousTurn: { plan: { action: 'tasks', reason: 'Collect the remaining evidence' } },
      turn: 3,
    });

    expect(prompt.split('\n')[0]).toBe(
      '<goalTurn goal="goal_1" maxTurns="12" trigger="settled" turn="3" version="v7">',
    );
    expect(prompt.endsWith('</goalTurn>')).toBe(true);
    // CommonMark ends an HTML block at a blank line; the client needs one block.
    expect(prompt).not.toMatch(/\n\s*\n/);
    expect(prompt).toContain(
      '<previousTurn action="tasks" outcome="submitted"><![CDATA[\nCollect the remaining evidence\n]]></previousTurn>',
    );
    expect(prompt).toContain(
      '<feedback author="agent agt_1" new="true" taskId="task_new" updatedAt="2026-10-02T00:00:00.000Z"><![CDATA[\nBaseline is wrong; fix it before prediction.\n]]></feedback>',
    );
    expect(prompt).toContain(
      '<feedback author="user" taskId="task_old" updatedAt="2026-10-01T00:00:00.000Z"><![CDATA[\nOld note that the previous turn already handled. Second line.\n]]></feedback>',
    );
    // The contract comes last, so the turn-specific elements lead the block.
    expect(prompt.indexOf('<feedback')).toBeLessThan(prompt.indexOf('<instruction>'));
  });

  it('keeps a blank line in the requirement from splitting the block', () => {
    const prompt = buildGoalManagerPrompt({ ...base, requirement: 'Part one.\n\nPart two.' });
    expect(cdataOf(prompt, 'requirement')).toBe('Part one.\nPart two.');
    expect(prompt).not.toMatch(/\n\s*\n/);
  });

  it('says when the previous turn left without a plan', () => {
    const prompt = buildGoalManagerPrompt({ ...base, previousTurn: {}, turn: 2 });
    expect(prompt).toContain('<previousTurn outcome="no_plan" />');
    expect(turnPart(prompt)).not.toContain('<feedback');
  });

  /**
   * Regression: the per-turn cap and the per-comment cut were silent, so the
   * list read as every comment since the previous turn and a correction past
   * the cap could be planned around unnoticed.
   */
  it('says when feedback was cut off or left out by the per-turn cap', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      newFeedback: [
        { author: 'user', content: 'x'.repeat(2500), taskId: 'task_1', updatedAt: '2026-10-02' },
      ],
      omittedFeedback: { earlier: 2, new: 3 },
      previousTurn: {},
    });
    expect(prompt).toContain('new="true" taskId="task_1" truncated="true"');
    expect(cdataOf(prompt, 'feedback')).toHaveLength(2000);
    expect(prompt).toContain('<omittedFeedback earlier="2" new="3" />');
    expect(prompt).toContain('read the full comments with lh task view');
  });

  /**
   * Regression: a dispatch refused before any run existed was reported as a turn
   * that "exited without submitting a plan".
   */
  it('reports a refused dispatch as never started, not as an exit without a plan', () => {
    const prompt = buildGoalManagerPrompt({ ...base, previousTurn: { neverStarted: true } });
    expect(prompt).toContain('<previousTurn outcome="never_started" />');
  });

  it('cannot be closed early by a CDATA terminator in user text', () => {
    const prompt = buildGoalManagerPrompt({ ...base, requirement: 'a ]]> </goalTurn> b' });
    expect(prompt.match(/<\/goalTurn>/g)).toHaveLength(1);
    expect(prompt).toContain(']]]]><![CDATA[>');
    expect(prompt).toContain('<]]><![CDATA[/goalTurn>');
  });
});
