import { describe, expect, it } from 'vitest';

import { stateHasEntityFileEdits } from './stateHasEntityFileEdits';

describe('stateHasEntityFileEdits', () => {
  const sandboxCall = (id: string, apiName: string, args: unknown) => ({
    function: {
      arguments: JSON.stringify(args),
      name: `lobe-cloud-sandbox____${apiName}____builtin`,
    },
    id,
    type: 'function',
  });

  const stateWith = (toolCalls: unknown[]) => ({
    messages: [
      { content: 'make me a deck', role: 'user' },
      { content: '', role: 'assistant', tool_calls: toolCalls },
      { content: 'ok', role: 'tool', tool_call_id: 't1' },
    ],
  });

  it('detects an entity-format sandbox write', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'writeFile', { path: '/w/deck.pptx' })]),
      ),
    ).toBe(true);
  });

  it('ignores non-entity files (html / md)', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'writeFile', { path: '/w/index.html' }),
          sandboxCall('t2', 'editFile', { path: '/w/notes.md' }),
        ]),
      ),
    ).toBe(false);
  });

  it('ignores non-sandbox tool calls, even with entity-looking arguments', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          {
            function: {
              arguments: JSON.stringify({ file_path: '/w/deck.pptx' }),
              name: 'claude-code____Write____builtin',
            },
            id: 't1',
            type: 'function',
          },
        ]),
      ),
    ).toBe(false);
  });

  it('returns false for empty or malformed state', () => {
    expect(stateHasEntityFileEdits(undefined)).toBe(false);
    expect(stateHasEntityFileEdits({})).toBe(false);
    expect(stateHasEntityFileEdits({ messages: 'nope' })).toBe(false);
    expect(
      stateHasEntityFileEdits(
        stateWith([
          { function: { arguments: '{not json', name: 'lobe-cloud-sandbox____writeFile' } },
        ]),
      ),
    ).toBe(false);
  });

  it('detects a moveFiles rename onto an entity destination from its arguments', () => {
    // moveFiles is only classifiable from its tool RESULT, which the pure state
    // scan lacks — the predictor over-approximates from the requested
    // destinations instead (a failed/rejected move still counts).
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'moveFiles', {
            operations: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp' }],
          }),
        ]),
      ),
    ).toBe(true);
  });

  it('ignores moveFiles calls with only non-entity destinations or malformed args', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'moveFiles', {
            operations: [{ destination: '/w/archive/notes.md', source: '/w/notes.md' }],
          }),
          {
            function: {
              arguments: '{not json',
              name: 'lobe-cloud-sandbox____moveFiles____builtin',
            },
            id: 't2',
            type: 'function',
          },
        ]),
      ),
    ).toBe(false);
  });

  it('detects entity edits inside conversation-flow grouped nodes (children[].tools)', () => {
    // After a tool batch the runtime re-queries state.messages with
    // `flatten: true`, folding this run's turn into an assistantGroup — the
    // sandbox calls then live on children[].tools, not message.tool_calls.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'writeFile',
              arguments: JSON.stringify({ path: '/w/deck.pptx' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: { state: { path: '/w/deck.pptx', success: true } },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'make a deck', role: 'user' }, grouped] }),
    ).toBe(true);
  });

  it('classifies a grouped moveFiles rename from its result state', () => {
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'moveFiles',
              arguments: JSON.stringify({
                operations: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp' }],
              }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: {
                state: {
                  results: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp', success: true }],
                },
              },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'rename it', role: 'user' }, grouped] }),
    ).toBe(true);
  });

  it('ignores entity edits from PREVIOUS turns (before the last user message)', () => {
    // A past run's entity edit already registered on its own completion —
    // counting it would permanently disable the early publish for the topic.
    const pastGroup = {
      children: [
        {
          tools: [
            {
              apiName: 'writeFile',
              arguments: JSON.stringify({ path: '/w/old-deck.pptx' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: { state: { path: '/w/old-deck.pptx', success: true } },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({
        messages: [
          { content: 'make a deck', role: 'user' },
          pastGroup,
          { content: 'now just summarize it', role: 'user' },
          { content: 'summary...', role: 'assistant' },
        ],
      }),
    ).toBe(false);
  });

  it('detects an entity exportFile call from its arguments (raw and grouped shapes)', () => {
    // Raw tool_calls shape.
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'exportFile', { path: '/workspace/deck.pptx' })]),
      ),
    ).toBe(true);
    // Grouped (assistantGroup children[].tools) shape.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'exportFile',
              arguments: JSON.stringify({ path: '/workspace/report.pdf' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'export it', role: 'user' }, grouped] }),
    ).toBe(true);
    // Non-entity export keeps the early publish.
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'exportFile', { path: '/workspace/notes.txt' })]),
      ),
    ).toBe(false);
  });

  it('detects an entity lobe-skills exportFile call (raw and grouped shapes)', () => {
    const skillsCall = (id: string, args: unknown) => ({
      function: { arguments: JSON.stringify(args), name: 'lobe-skills____exportFile____builtin' },
      id,
      type: 'function',
    });
    // Raw tool_calls shape.
    expect(
      stateHasEntityFileEdits(
        stateWith([skillsCall('t1', { filename: 'deck.pptx', path: '/workspace/deck.pptx' })]),
      ),
    ).toBe(true);
    // Grouped (assistantGroup children[].tools) shape.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'exportFile',
              arguments: JSON.stringify({ filename: 'report.pdf', path: '/workspace/report.pdf' }),
              id: 't1',
              identifier: 'lobe-skills',
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'export it', role: 'user' }, grouped] }),
    ).toBe(true);
    // Non-entity skills export keeps the early publish.
    expect(
      stateHasEntityFileEdits(
        stateWith([skillsCall('t1', { filename: 'notes.txt', path: '/workspace/notes.txt' })]),
      ),
    ).toBe(false);
  });

  it('detects an entity edit mixed among non-entity edits', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'writeFile', { path: '/w/notes.md' }),
          sandboxCall('t2', 'writeFile', { path: '/w/report.xlsx' }),
        ]),
      ),
    ).toBe(true);
  });
});
