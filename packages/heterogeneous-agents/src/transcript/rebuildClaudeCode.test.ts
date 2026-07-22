import type { HeteroSessionImportMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { parseClaudeCodeSession } from './claudeCode';
import { buildClaudeCodeTranscript, encodeClaudeProjectDir } from './rebuildClaudeCode';

const SESSION_ID = '72f65fa9-0355-45d3-b903-8f41027ed5f2';
const CWD = '/Users/arvinxx/CodeProjects/LobeHub/lobehub-cloud-cc';

const parseLines = (jsonl: string) =>
  jsonl
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

const userMsg = (content: string): HeteroSessionImportMessage => ({
  clientId: `u-${content.slice(0, 6)}`,
  content,
  createdAt: '2026-07-01T00:00:00.000Z',
  role: 'user',
});

const assistantMsg = (
  content: string,
  tools?: HeteroSessionImportMessage['tools'],
): HeteroSessionImportMessage => ({
  clientId: `a-${content.slice(0, 6)}`,
  content,
  createdAt: '2026-07-01T00:00:01.000Z',
  role: 'assistant',
  ...(tools ? { tools } : {}),
});

const toolMsg = (toolCallId: string, content: string): HeteroSessionImportMessage => ({
  clientId: `t-${toolCallId}`,
  content,
  createdAt: '2026-07-01T00:00:02.000Z',
  role: 'tool',
  toolCallId,
});

describe('buildClaudeCodeTranscript', () => {
  it('emits a parentUuid chain the CLI can hydrate (first user parentUuid=null)', () => {
    const jsonl = buildClaudeCodeTranscript([userMsg('hi'), assistantMsg('hello')], {
      cwd: CWD,
      sessionId: SESSION_ID,
    });
    const recs = parseLines(jsonl);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ type: 'user', parentUuid: null, sessionId: SESSION_ID });
    expect(recs[1]).toMatchObject({ type: 'assistant', parentUuid: recs[0].uuid });
    // every record stamps the same session + cwd so the file is self-consistent
    for (const r of recs) {
      expect(r.sessionId).toBe(SESSION_ID);
      expect(r.cwd).toBe(CWD);
      expect(r.uuid).toMatch(/^[\da-f-]{36}$/);
    }
  });

  it('round-trips through the parser back to the same normalized messages', () => {
    const original: HeteroSessionImportMessage[] = [
      userMsg('Check the deploy region.'),
      assistantMsg('Reading config.', [
        {
          apiName: 'Read',
          arguments: '{"file_path":"/repo/deploy.json"}',
          id: 'toolu_1',
          identifier: 'claude-code',
          type: 'default',
        },
      ]),
      toolMsg('toolu_1', '{ "region": "ap-osaka-3" }'),
      assistantMsg('The region is ap-osaka-3.'),
    ];
    const jsonl = buildClaudeCodeTranscript(original, { cwd: CWD, sessionId: SESSION_ID });
    const parsed = parseClaudeCodeSession(jsonl);
    expect(parsed).not.toBeNull();
    const roles = parsed!.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(parsed!.messages[0].content).toBe('Check the deploy region.');
    expect(parsed!.messages[1].tools?.[0]).toMatchObject({ apiName: 'Read', id: 'toolu_1' });
    expect(parsed!.messages[2].content).toBe('{ "region": "ap-osaka-3" }');
    expect(parsed!.messages[2].toolCallId).toBe('toolu_1');
    expect(parsed!.messages[3].content).toBe('The region is ap-osaka-3.');
    expect(parsed!.sessionId).toBe(SESSION_ID);
    expect(parsed!.workingDirectory).toBe(CWD);
  });

  it('drops thinking/reasoning — no signature to replay, would 400 the API', () => {
    const msg: HeteroSessionImportMessage = {
      ...assistantMsg('visible answer'),
      reasoning: { content: 'secret chain of thought' },
    };
    const jsonl = buildClaudeCodeTranscript([userMsg('q'), msg], {
      cwd: CWD,
      sessionId: SESSION_ID,
    });
    expect(jsonl).not.toContain('thinking');
    expect(jsonl).not.toContain('secret chain of thought');
    const asst = parseLines(jsonl)[1];
    expect(asst.message.content).toEqual([{ type: 'text', text: 'visible answer' }]);
  });

  it('trims a trailing unanswered tool_use (would 400 the next turn)', () => {
    const jsonl = buildClaudeCodeTranscript(
      [
        userMsg('go'),
        assistantMsg('running', [
          {
            apiName: 'Bash',
            arguments: '{}',
            id: 'toolu_dangling',
            identifier: 'claude-code',
            type: 'default',
          },
        ]),
      ],
      { cwd: CWD, sessionId: SESSION_ID },
    );
    // the assistant tool_use has no matching tool_result → trimmed away,
    // leaving just the user turn (still a valid, resumable transcript)
    const recs = parseLines(jsonl);
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe('user');
    expect(jsonl).not.toContain('toolu_dangling');
  });

  it('keeps a resolved tool_use but trims a later dangling one', () => {
    const jsonl = buildClaudeCodeTranscript(
      [
        userMsg('go'),
        assistantMsg('a', [
          {
            apiName: 'Read',
            arguments: '{}',
            id: 'toolu_ok',
            identifier: 'claude-code',
            type: 'default',
          },
        ]),
        toolMsg('toolu_ok', 'result'),
        assistantMsg('b', [
          {
            apiName: 'Bash',
            arguments: '{}',
            id: 'toolu_bad',
            identifier: 'claude-code',
            type: 'default',
          },
        ]),
      ],
      { cwd: CWD, sessionId: SESSION_ID },
    );
    expect(jsonl).toContain('toolu_ok');
    expect(jsonl).not.toContain('toolu_bad');
    const recs = parseLines(jsonl);
    // user, assistant(tool_ok), tool_result — the dangling assistant is gone
    expect(recs.map((r: any) => r.type)).toEqual(['user', 'assistant', 'user']);
  });

  it('returns empty string when there is nothing replay-worthy', () => {
    expect(buildClaudeCodeTranscript([], { cwd: CWD, sessionId: SESSION_ID })).toBe('');
  });
});

describe('encodeClaudeProjectDir', () => {
  it('replaces every non-alphanumeric char with a dash (matches the CLI)', () => {
    expect(encodeClaudeProjectDir('/Users/arvinxx/CodeProjects/LobeHub/lobehub-cloud-cc')).toBe(
      '-Users-arvinxx-CodeProjects-LobeHub-lobehub-cloud-cc',
    );
    expect(encodeClaudeProjectDir('/private/tmp/cc-resurrect-lab')).toBe(
      '-private-tmp-cc-resurrect-lab',
    );
  });

  it('collapses dots and underscores to dashes too', () => {
    expect(encodeClaudeProjectDir('/a/b.c_d')).toBe('-a-b-c-d');
  });
});
