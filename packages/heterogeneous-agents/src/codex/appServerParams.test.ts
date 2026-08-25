import { describe, expect, it } from 'vitest';

import {
  buildCodexAppServerArgs,
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  getCodexAppServerUnsupportedArgs,
} from './appServerParams';

describe('Codex app-server payload builders', () => {
  it('keeps process args global and translates runtime flags into thread params', () => {
    expect(buildCodexAppServerArgs()).toEqual(['app-server']);
    expect(
      buildCodexAppServerArgs([
        '--model',
        'gpt-5.5-codex',
        '-c',
        'model_reasoning_effort="high"',
        '--config=service_tier="fast"',
      ]),
    ).toEqual(['app-server']);
    expect(
      buildCodexAppServerThreadParams(
        [
          '--model',
          'gpt-5.5-codex',
          '-s',
          'read-only',
          '-a',
          'never',
          '--cd',
          'nested',
          '--ephemeral',
          '-c',
          'model_reasoning_effort="high"',
          '-c',
          'model_provider="openai"',
          '--config=service_tier="fast"',
        ],
        '/workspace',
      ),
    ).toEqual({
      approvalPolicy: 'never',
      config: {
        model_provider: 'openai',
        model_reasoning_effort: 'high',
        service_tier: 'fast',
      },
      cwd: '/workspace/nested',
      ephemeral: true,
      model: 'gpt-5.5-codex',
      modelProvider: 'openai',
      sandbox: 'read-only',
      serviceTier: 'fast',
    });
    expect(buildCodexAppServerThreadParams(['--full-auto'], '/workspace')).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    });
    expect(
      buildCodexAppServerThreadParams(['--dangerously-bypass-approvals-and-sandbox'], '/workspace'),
    ).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
  });

  it('keeps unsupported and interactive CLI arguments on the exec transport', () => {
    expect(getCodexAppServerUnsupportedArgs(['--profile', 'work'])).toEqual(['--profile']);
    expect(getCodexAppServerUnsupportedArgs(['--ignore-user-config'])).toEqual([
      '--ignore-user-config',
    ]);
    expect(getCodexAppServerUnsupportedArgs(['--full-auto'])).toEqual(['--full-auto']);
    expect(getCodexAppServerUnsupportedArgs(['-a', 'on-request'])).toEqual(['-a']);
    expect(getCodexAppServerUnsupportedArgs(['-c', 'approval_policy="untrusted"'])).toEqual(['-c']);
    expect(getCodexAppServerUnsupportedArgs(['--search'])).toEqual(['--search']);
    expect(getCodexAppServerUnsupportedArgs(['--model', '--ephemeral'])).toEqual(['--model']);
    expect(getCodexAppServerUnsupportedArgs(['--sandbox', 'invalid'])).toEqual(['--sandbox']);
    expect(
      getCodexAppServerUnsupportedArgs([
        '--dangerously-bypass-approvals-and-sandbox',
        '--sandbox',
        'read-only',
      ]),
    ).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
    expect(getCodexAppServerUnsupportedArgs(['--ephemeral'], { resume: true })).toEqual([
      '--ephemeral',
    ]);
    expect(
      getCodexAppServerUnsupportedArgs([
        '--model',
        'gpt-5.5-codex',
        '-a',
        'never',
        '-c',
        'service_tier="fast"',
        '--cd=src',
        '--ephemeral',
      ]),
    ).toEqual([]);
  });

  it('converts Codex text and --image args into v2 turn inputs', () => {
    expect(
      buildCodexAppServerInput({
        args: ['--image', '/tmp/a.png', '--image', '/tmp/b.jpg'],
        stdin: 'describe these',
      }),
    ).toEqual([
      { text: 'describe these', text_elements: [], type: 'text' },
      { path: '/tmp/a.png', type: 'localImage' },
      { path: '/tmp/b.jpg', type: 'localImage' },
    ]);
  });
});
