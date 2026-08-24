import { describe, expect, it } from 'vitest';

import { parseCommandInput } from './parseCommandInput';

describe('parseCommandInput', () => {
  it('splits a pasted command line into command and args', () => {
    expect(parseCommandInput('uv run idalib-mcp --stdio')).toEqual({
      args: ['run', 'idalib-mcp', '--stdio'],
      command: 'uv',
    });
  });

  it('returns null for a bare command', () => {
    expect(parseCommandInput('npx')).toBeNull();
    expect(parseCommandInput('  npx  ')).toBeNull();
    expect(parseCommandInput('')).toBeNull();
  });

  it('keeps quoted segments as single args', () => {
    expect(parseCommandInput('node "my server.js" --name \'a b\'')).toEqual({
      args: ['my server.js', '--name', 'a b'],
      command: 'node',
    });
  });
});
