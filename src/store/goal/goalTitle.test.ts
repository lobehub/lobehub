import { describe, expect, it } from 'vitest';

import { buildGoalTitleMessages } from './goalTitle';

const snapshot = (goal: Record<string, unknown>, nodes: unknown[] = []) =>
  ({ goal: { id: 'goal-1', status: 'paused', ...goal }, nodes }) as never;

describe('buildGoalTitleMessages', () => {
  it('asks with the requirement, not a title that is the whole prompt', () => {
    const messages = buildGoalTitleMessages(
      snapshot({ requirement: 'Finish the desk pet TTS system', title: 'old title' }),
    );

    expect(messages).toEqual([{ content: 'Finish the desk pet TTS system', role: 'user' }]);
  });

  it('falls back to the title when the goal has no requirement', () => {
    expect(buildGoalTitleMessages(snapshot({ requirement: null, title: 'Ship v2' }))).toEqual([
      { content: 'Ship v2', role: 'user' },
    ]);
  });

  it('adds the tasks and findings produced so far as the reply', () => {
    const messages = buildGoalTitleMessages(
      snapshot({ requirement: 'Ask', title: 'Ask' }, [
        { kind: 'problem', title: 'Root' },
        { kind: 'task', title: 'Wire TTS' },
        { kind: 'finding', title: 'Edge TTS is fast' },
      ]),
    );

    expect(messages[1]).toEqual({
      content: '- Task: Wire TTS\n- Finding: Edge TTS is fast',
      role: 'assistant',
    });
  });

  it('caps how many nodes reach the prompt', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({ kind: 'task', title: `T${index}` }));
    const [, reply] = buildGoalTitleMessages(snapshot({ requirement: 'Ask' }, nodes));

    expect(reply.content.split('\n')).toHaveLength(20);
  });

  it('caps Tasks and findings together, Tasks first', () => {
    const nodes = [
      ...Array.from({ length: 15 }, (_, index) => ({ kind: 'task', title: `T${index}` })),
      ...Array.from({ length: 15 }, (_, index) => ({ kind: 'finding', title: `F${index}` })),
    ];
    const [, reply] = buildGoalTitleMessages(snapshot({ requirement: 'Ask' }, nodes));
    const lines = reply.content.split('\n');

    expect(lines).toHaveLength(20);
    expect(lines.filter((line) => line.startsWith('- Task:'))).toHaveLength(15);
  });
});
