import { describe, expect, it } from 'vitest';

import { MessageManifest } from './manifest';
import { resolveMessageManifest } from './resolveManifest';
import { MessageApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveMessageManifest', () => {
  it('returns the full static manifest when no botPlatform context is set', () => {
    expect(resolveMessageManifest({})).toBe(MessageManifest);
    expect(resolveMessageManifest({ botPlatform: { id: 'discord' } })).toBe(MessageManifest);
  });

  it('returns the full static manifest when the unsupported list is empty', () => {
    expect(
      resolveMessageManifest({ botPlatform: { id: 'discord', unsupportedMessageApis: [] } }),
    ).toBe(MessageManifest);
  });

  it('returns the full static manifest when unsupported APIs are not in the manifest', () => {
    const result = resolveMessageManifest({
      botPlatform: { id: 'x', unsupportedMessageApis: ['not-a-real-api'] },
    });
    expect(result).toBe(MessageManifest);
  });

  it('drops unsupported APIs from the tool list (WeChat readMessages case)', () => {
    const result = resolveMessageManifest({
      botPlatform: {
        id: 'wechat',
        unsupportedMessageApis: [MessageApiName.readMessages, MessageApiName.editMessage],
      },
    })!;

    const names = apiNames(result);
    expect(names).not.toContain(MessageApiName.readMessages);
    expect(names).not.toContain(MessageApiName.editMessage);
    // exactly two APIs removed; everything else (e.g. sendMessage) stays
    expect(names).toContain(MessageApiName.sendMessage);
    expect(names).toHaveLength(MessageManifest.api.length - 2);
  });

  it('rewrites systemRole so the model is told the APIs are unavailable', () => {
    const result = resolveMessageManifest({
      botPlatform: { id: 'wechat', unsupportedMessageApis: [MessageApiName.readMessages] },
    })!;

    expect(result.systemRole).toContain('platform_unavailable_apis');
    expect(result.systemRole).toContain(MessageApiName.readMessages);
    // the base tool documentation is preserved
    expect(result.systemRole).toContain(MessageManifest.systemRole);
  });

  it('does not mutate the original static manifest', () => {
    const before = MessageManifest.api.length;
    resolveMessageManifest({
      botPlatform: { id: 'wechat', unsupportedMessageApis: [MessageApiName.readMessages] },
    });
    expect(MessageManifest.api).toHaveLength(before);
  });
});
