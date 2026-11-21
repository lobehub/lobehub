import { describe, expect, it } from 'vitest';

import { WebBrowsingManifest } from './manifest';

describe('WebBrowsingManifest', () => {
  it('does not embed a static import-time Current date line in systemRole', () => {
    expect(WebBrowsingManifest.systemRole).not.toMatch(/Current date:/i);
  });
});
