import { describe, expect, it, vi } from 'vitest';

import { workTypeOptIn } from './workTypeOptIn';

const { state } = vi.hoisted(() => ({ state: { current: undefined as unknown } }));
vi.mock('@/store/serverConfig/store', () => ({ getServerConfigStoreState: () => state.current }));

describe('workTypeOptIn', () => {
  it('asks for artboard Works only while the artboard flag is on', () => {
    state.current = { featureFlags: { enableArtboard: true } };
    expect(workTypeOptIn()).toEqual({ includeArtboardWorks: true, includeFileWorks: true });

    state.current = { featureFlags: {} };
    expect(workTypeOptIn().includeArtboardWorks).toBe(false);
  });

  it('keeps the file opt-in before the server config has loaded', () => {
    state.current = undefined;
    expect(workTypeOptIn()).toEqual({ includeArtboardWorks: false, includeFileWorks: true });
  });
});
