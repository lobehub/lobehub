import { describe, expect, it, vi } from 'vitest';

import { CodexRenderDisplayControls } from './codex/displayControls';
import { getBuiltinRenderDisplayControl } from './displayControls';

vi.mock('@lobechat/builtin-tool-claude-code/client', () => ({
  ClaudeCodeIdentifier: 'claude-code',
  // Stand-in for the real resolver: only `Read` on an uploaded image expands.
  resolveClaudeCodeRenderDisplayControl: (apiName: string, pluginState?: any) =>
    apiName === 'Read' && pluginState?.images?.some((image: any) => !!image.url)
      ? 'expand'
      : undefined,
}));

describe('CodexRenderDisplayControls', () => {
  it('collapses Codex command output by default', () => {
    expect(CodexRenderDisplayControls.command_execution).toBe('collapsed');
    expect(getBuiltinRenderDisplayControl('codex', 'command_execution')).toBe('collapsed');
  });
});

describe('getBuiltinRenderDisplayControl', () => {
  it('routes a package with a dynamic resolver through it, forwarding pluginState', () => {
    expect(
      getBuiltinRenderDisplayControl('claude-code', 'Read', {
        images: [{ mediaType: 'image/png', url: 'https://cdn/a.png' }],
      }),
    ).toBe('expand');
  });

  it('leaves a non-image Read undecided, so the caller falls back to collapsed', () => {
    expect(getBuiltinRenderDisplayControl('claude-code', 'Read')).toBeUndefined();
    expect(getBuiltinRenderDisplayControl('claude-code', 'Read', {})).toBeUndefined();
  });

  it('returns undefined without an identifier or apiName', () => {
    expect(getBuiltinRenderDisplayControl(undefined, 'Read')).toBeUndefined();
    expect(getBuiltinRenderDisplayControl('claude-code', undefined)).toBeUndefined();
  });
});
