import { describe, expect, it, vi } from 'vitest';

import { selectAgentArtworkModel } from '@/store/agent/slices/artwork/utils';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { avatarRemountKey, openFilePicker, resolveAgentBackground } from './utils';

describe('openFilePicker', () => {
  it('uses the native picker while preserving click as a compatibility fallback', () => {
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const showPicker = vi.fn();
    input.showPicker = showPicker;

    openFilePicker(input);

    expect(showPicker).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();

    showPicker.mockImplementation(() => {
      throw new Error('showPicker is unavailable');
    });
    openFilePicker(input);

    expect(click).toHaveBeenCalledOnce();
  });
});

const createProvider = (id: string, modelIds: string[]): EnabledProviderWithModels => ({
  children: modelIds.map((modelId) => ({ abilities: {}, id: modelId })),
  id,
  name: id,
  source: 'builtin',
});

describe('resolveAgentBackground', () => {
  it.each(['#fff', 'rgb(0, 0, 0)', 'transparent', 'red', 'rgba(0,0,0,0)'])(
    'ignores the legacy color value %s',
    (value) => {
      expect(resolveAgentBackground(value)).toBeUndefined();
    },
  );

  it.each([
    'https://example.com/cover.webp',
    'http://example.com/cover.png',
    '/f/file-id',
    'data:image/png;base64,abc',
  ])('keeps the image source %s', (value) => {
    expect(resolveAgentBackground(value)).toBe(value);
  });
});

describe('selectAgentArtworkModel', () => {
  it('prefers gpt-image-2 when another provider appears first', () => {
    const selection = selectAgentArtworkModel([
      createProvider('google', ['imagen-4']),
      createProvider('openai', ['gpt-image-2']),
    ]);

    expect(selection?.provider.id).toBe('openai');
    expect(selection?.model.id).toBe('gpt-image-2');
  });

  it('falls back to the first available image model', () => {
    expect(selectAgentArtworkModel([createProvider('fal', ['flux'])])?.model.id).toBe('flux');
  });
});

/**
 * `@lobehub/ui`'s `Avatar` latches an internal image-error flag and never
 * clears it when `avatar` changes, so a broken avatar url would keep every
 * later one — including a freshly generated one — invisible until a reload.
 * Every avatar render site keys off this helper to force a clean remount, so
 * the key MUST change with the url and MUST NOT change for anything else.
 */
describe('avatarRemountKey', () => {
  it('changes when the avatar url changes', () => {
    expect(avatarRemountKey('http://example.com/a.png')).not.toBe(
      avatarRemountKey('http://example.com/b.png'),
    );
  });

  it('stays stable for the same avatar so unrelated re-renders do not remount', () => {
    expect(avatarRemountKey('http://example.com/a.png')).toBe(
      avatarRemountKey('http://example.com/a.png'),
    );
  });

  it('collapses every empty value onto one placeholder key', () => {
    expect(avatarRemountKey(undefined)).toBe(avatarRemountKey(null));
    expect(avatarRemountKey('')).toBe(avatarRemountKey(undefined));
  });
});
