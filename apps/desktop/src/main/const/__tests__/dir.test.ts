import path from 'node:path';

import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppStorageDir, getLegacyLocalDbDir, getUserDataDir } from '../dir';
import { getStoreDefaults } from '../store';

/**
 * `pre-app-init.ts` renames a branded build and calls
 * `app.setPath('userData', ...)` so its data does not land in this repository's
 * own `lobehub-desktop-dev` profile. The bundler is free to order that after
 * this module loads, so anything these paths capture at import time points at
 * the dev profile for the whole life of the process -- which is what shipped.
 *
 * The behaviour under test is therefore *when* the lookup happens, not what it
 * returns: every path has to be derived on call.
 */
describe('userData-derived paths', () => {
  const brandedUserData = path.join('/appdata', 'TiTu Work');

  beforeEach(() => {
    vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  });

  const relocateUserData = () => {
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? brandedUserData : `/mock/${name}`,
    );
  };

  it('picks up a userData path set after this module was imported', () => {
    expect(getUserDataDir()).toBe('/mock/userData');

    relocateUserData();

    expect(getUserDataDir()).toBe(brandedUserData);
    expect(getAppStorageDir()).toBe(path.join(brandedUserData, 'lobehub-storage'));
    expect(getLegacyLocalDbDir()).toBe(
      path.join(brandedUserData, 'lobehub-storage', 'lobehub-local-db'),
    );
  });

  it('derives the default storagePath when the store is built, not when the module loads', () => {
    relocateUserData();

    expect(getStoreDefaults().storagePath).toBe(path.join(brandedUserData, 'lobehub-storage'));
  });
});
