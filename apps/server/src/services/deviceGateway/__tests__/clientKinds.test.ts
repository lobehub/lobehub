import { AuvIdentifier } from '@lobechat/builtin-tool-auv';
import { BrowserIdentifier } from '@lobechat/builtin-tool-browser';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { describe, expect, it } from 'vitest';

import { resolveDeviceClientKinds } from '../clientKinds';

describe('resolveDeviceClientKinds', () => {
  it('keeps desktop-only builtin tools off `lh connect`', () => {
    expect(
      resolveDeviceClientKinds({ identifier: AuvIdentifier, kind: 'tool', type: 'tool' }),
    ).toEqual(['desktop']);
    expect(
      resolveDeviceClientKinds({ identifier: BrowserIdentifier, kind: 'tool', type: 'tool' }),
    ).toEqual(['desktop']);
  });

  it('lets any client run tools both clients implement', () => {
    expect(
      resolveDeviceClientKinds({ identifier: LocalSystemIdentifier, kind: 'tool', type: 'tool' }),
    ).toBeUndefined();
    expect(
      resolveDeviceClientKinds({ identifier: 'local', kind: 'tool', type: 'tool' }),
    ).toBeUndefined();
  });

  it('routes MCP calls and the message API to the desktop app', () => {
    expect(
      resolveDeviceClientKinds({ identifier: 'some-mcp-server', kind: 'tool', type: 'mcp' }),
    ).toEqual(['desktop']);
    expect(resolveDeviceClientKinds({ kind: 'messageApi', platform: 'imessage' })).toEqual([
      'desktop',
    ]);
  });

  it('reads RPC support from device-control', () => {
    expect(resolveDeviceClientKinds({ kind: 'rpc', method: 'trashLocalFiles' })).toEqual([
      'desktop',
    ]);
    expect(resolveDeviceClientKinds({ kind: 'rpc', method: 'installAppUpdate' })).toEqual([
      'desktop',
    ]);
    for (const method of ['getCliUpdateState', 'checkCliUpdate', 'restartCli'])
      expect(resolveDeviceClientKinds({ kind: 'rpc', method })).toEqual(['cli']);
    expect(resolveDeviceClientKinds({ kind: 'rpc', method: 'getGitBranch' })).toBeUndefined();
  });
});
