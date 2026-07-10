import { describe, expect, it } from 'vitest';

import {
  getCodexCommandProgram,
  getCodexGrepCommandDisplay,
  getCodexReadFileCommandDisplay,
} from './commandExecutionUtils';

describe('getCodexReadFileCommandDisplay', () => {
  it('parses sed range reads', () => {
    expect(
      getCodexReadFileCommandDisplay(
        "sed -n '1,260p' src/features/Conversation/Messages/AssistantGroup/Tool/index.tsx",
      ),
    ).toEqual({
      endLine: 260,
      filePath: 'src/features/Conversation/Messages/AssistantGroup/Tool/index.tsx',
      startLine: 1,
    });
  });

  it('parses double quoted and bare ranges', () => {
    expect(getCodexReadFileCommandDisplay('sed -n "260,620p" packages/foo.ts')).toEqual({
      endLine: 620,
      filePath: 'packages/foo.ts',
      startLine: 260,
    });
    expect(getCodexReadFileCommandDisplay('sed -n 42p packages/foo.ts')).toEqual({
      filePath: 'packages/foo.ts',
      startLine: 42,
    });
  });

  it('unwraps simple shell wrappers', () => {
    expect(
      getCodexReadFileCommandDisplay("/bin/zsh -lc 'sed -n '\\''1,260p'\\'' packages/foo.ts'"),
    ).toEqual({
      endLine: 260,
      filePath: 'packages/foo.ts',
      startLine: 1,
    });
  });

  it('supports a quoted file path token', () => {
    expect(getCodexReadFileCommandDisplay("sed -n '1,3p' 'src/foo bar.ts'")).toEqual({
      endLine: 3,
      filePath: 'src/foo bar.ts',
      startLine: 1,
    });
  });

  it('parses cat single file reads', () => {
    expect(getCodexReadFileCommandDisplay('cat .agents/skills/react/SKILL.md')).toEqual({
      filePath: '.agents/skills/react/SKILL.md',
    });
    expect(getCodexReadFileCommandDisplay("cat -- 'src/foo bar.ts'")).toEqual({
      filePath: 'src/foo bar.ts',
    });
  });

  it('ignores commands with extra shell behavior', () => {
    expect(getCodexReadFileCommandDisplay("sed -n '1,260p' src/foo.ts | head")).toBeUndefined();
    expect(getCodexReadFileCommandDisplay("sed -n '1,260p' src/foo.ts > /tmp/out")).toBeUndefined();
    expect(getCodexReadFileCommandDisplay("sed -n '1,260p;2,3p' src/foo.ts")).toBeUndefined();
    expect(getCodexReadFileCommandDisplay('cat src/foo.ts src/bar.ts')).toBeUndefined();
    expect(getCodexReadFileCommandDisplay('cat src/foo.ts | head')).toBeUndefined();
  });
});

describe('getCodexGrepCommandDisplay', () => {
  it('parses simple rg content searches', () => {
    expect(getCodexGrepCommandDisplay('rg "createReadLocalFileInspector" packages src')).toEqual({
      pattern: 'createReadLocalFileInspector',
    });
  });

  it('parses rg --files pipelines', () => {
    expect(
      getCodexGrepCommandDisplay(
        'rg --files packages src | rg "codex|AssistantGroup/Tool|toolDisplayNames"',
      ),
    ).toEqual({
      pattern: 'codex|AssistantGroup/Tool|toolDisplayNames',
    });
  });

  it('parses rg regexp options', () => {
    expect(getCodexGrepCommandDisplay('rg -n -e "foo|bar" src')).toEqual({
      pattern: 'foo|bar',
    });
    expect(getCodexGrepCommandDisplay('rg --regexp=foo src')).toEqual({
      pattern: 'foo',
    });
  });

  it('ignores unsafe or unsupported rg commands', () => {
    expect(getCodexGrepCommandDisplay('rg "foo" src > /tmp/out')).toBeUndefined();
    expect(getCodexGrepCommandDisplay('rg --files src | sort | rg "foo"')).toBeUndefined();
    expect(getCodexGrepCommandDisplay('rg --files src')).toBeUndefined();
  });
});

describe('getCodexCommandProgram', () => {
  it('classifies node commands', () => {
    expect(getCodexCommandProgram('node packages/cli/dist/index.js message-gateway stats')).toBe(
      'node',
    );
    expect(getCodexCommandProgram('node -e "const fs=require(\'fs\')"')).toBe('node');
  });

  it('classifies git commands', () => {
    expect(getCodexCommandProgram('git diff -- package.json')).toBe('git');
    expect(getCodexCommandProgram('git status --short')).toBe('git');
  });

  it('classifies python commands, including python3 and absolute paths', () => {
    expect(getCodexCommandProgram('python analyze.py')).toBe('python');
    expect(getCodexCommandProgram('python3 -m http.server')).toBe('python');
    expect(getCodexCommandProgram('/usr/bin/python3 script.py')).toBe('python');
  });

  it('unwraps shell wrappers and skips env assignments', () => {
    expect(getCodexCommandProgram('bash -lc "git log --oneline"')).toBe('git');
    expect(getCodexCommandProgram('NODE_ENV=production node app.js')).toBe('node');
  });

  it('returns undefined for unknown or empty programs', () => {
    expect(getCodexCommandProgram('pnpm install')).toBeUndefined();
    expect(getCodexCommandProgram('ls -la')).toBeUndefined();
    expect(getCodexCommandProgram('cat foo | node bar.js')).toBeUndefined();
    expect(getCodexCommandProgram('')).toBeUndefined();
    expect(getCodexCommandProgram(undefined)).toBeUndefined();
  });
});
