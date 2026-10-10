import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { describe, expect, it } from 'vitest';

import {
  isCapabilityTool,
  resolveCapabilityConfigPatch,
  resolveCapabilityMode,
} from './capabilityTools';

describe('capabilityTools', () => {
  describe('resolveCapabilityMode', () => {
    it('reports an enabled capability as Auto', () => {
      expect(resolveCapabilityMode(true)).toBe('auto');
    });

    it('reports a disabled capability as Disabled', () => {
      expect(resolveCapabilityMode(false)).toBe('disabled');
    });

    it('reports a pinned capability as Pinned, whether or not it is enabled', () => {
      expect(resolveCapabilityMode(true, true)).toBe('pinned');
      expect(resolveCapabilityMode(false, true)).toBe('pinned');
    });
  });

  describe('isCapabilityTool', () => {
    it('recognises memory and web browsing', () => {
      expect(isCapabilityTool(MemoryManifest.identifier)).toBe(true);
      expect(isCapabilityTool(WebBrowsingManifest.identifier)).toBe(true);
    });

    it('leaves ordinary skills on the plugin policy', () => {
      expect(isCapabilityTool('some-mcp-plugin')).toBe(false);
    });
  });

  describe('resolveCapabilityConfigPatch', () => {
    it('turns memory off through chatConfig while keeping it on for Auto', () => {
      expect(resolveCapabilityConfigPatch(MemoryManifest.identifier, 'disabled')).toEqual({
        memory: { enabled: false },
      });
      expect(resolveCapabilityConfigPatch(MemoryManifest.identifier, 'auto')).toEqual({
        memory: { enabled: true },
      });
    });

    it('maps web browsing Auto/Disable onto the search mode', () => {
      expect(resolveCapabilityConfigPatch(WebBrowsingManifest.identifier, 'disabled')).toEqual({
        searchMode: 'off',
      });
      expect(resolveCapabilityConfigPatch(WebBrowsingManifest.identifier, 'auto')).toEqual({
        searchMode: 'auto',
      });
    });

    it('keeps the capability on when it is Pinned, like Auto', () => {
      expect(resolveCapabilityConfigPatch(MemoryManifest.identifier, 'pinned')).toEqual({
        memory: { enabled: true },
      });
      expect(resolveCapabilityConfigPatch(WebBrowsingManifest.identifier, 'pinned')).toEqual({
        searchMode: 'auto',
      });
    });

    it('returns no patch for a tool that is not a capability', () => {
      expect(resolveCapabilityConfigPatch('some-mcp-plugin', 'disabled')).toBeUndefined();
      expect(resolveCapabilityConfigPatch('some-mcp-plugin', 'pinned')).toBeUndefined();
    });
  });
});
