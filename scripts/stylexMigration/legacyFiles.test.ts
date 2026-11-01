// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findStaleLegacyFiles, readLegacyFiles, scanRepo } from '.';

describe('legacyFiles.json', () => {
  it('lists only files that still import emotion styles', () => {
    const stale = findStaleLegacyFiles(scanRepo());

    // A migrated or deleted file is still listed. Run:
    //   bun run stylex:migration --prune-legacy
    expect(stale).toEqual([]);
  });

  it('stays sorted so pruning diffs only remove lines', () => {
    const legacy = readLegacyFiles();
    expect(legacy).toEqual([...legacy].sort());
  });
});
