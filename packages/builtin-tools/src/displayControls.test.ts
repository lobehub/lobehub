import { describe, expect, it, vi } from 'vitest';

import { CodexRenderDisplayControls } from './codex/displayControls';
import { getBuiltinRenderDisplayControl } from './displayControls';

vi.mock('@lobechat/builtin-tool-claude-code/client', () => ({
  ClaudeCodeIdentifier: 'claude-code',
  ClaudeCodeRenderDisplayControls: {},
}));

describe('CodexRenderDisplayControls', () => {
  it('collapses Codex command output by default', () => {
    expect(CodexRenderDisplayControls.command_execution).toBe('collapsed');
    expect(getBuiltinRenderDisplayControl('codex', 'command_execution')).toBe('collapsed');
  });
});
