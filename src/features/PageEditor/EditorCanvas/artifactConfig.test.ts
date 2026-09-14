import { describe, expect, it } from 'vitest';

import { createPageArtifactPluginProps } from './artifactConfig';

describe('Page Artifact plugin configuration', () => {
  it('enables scripts for interactive previews without changing the opaque sandbox contract', () => {
    expect(createPageArtifactPluginProps({})).toMatchObject({ allowScripts: true });
  });
});
