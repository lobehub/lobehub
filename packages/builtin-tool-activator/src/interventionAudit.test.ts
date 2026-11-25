import { describe, expect, it } from 'vitest';

import { activateToolsAudit } from './interventionAudit';

const metadata = { enabledToolIds: ['builtin-artboard', 'lobe-web-browsing'] };

describe('activateToolsAudit', () => {
  it('lets a request for tools the run already offers through without asking', async () => {
    expect(await activateToolsAudit({ identifiers: ['builtin-artboard'] }, metadata)).toBe(false);
    expect(
      await activateToolsAudit(
        { identifiers: ['builtin-artboard____listArtboardComments', 'lobe-web-browsing'] },
        metadata,
      ),
    ).toBe(false);
  });

  it('asks when any requested identifier is not already offered', async () => {
    expect(
      await activateToolsAudit({ identifiers: ['builtin-artboard', 'lobe-notebook'] }, metadata),
    ).toBe(true);
    expect(await activateToolsAudit({ identifiers: ['artboard'] }, metadata)).toBe(true);
  });

  it('asks when the run reports no enabled tools or the request is empty', async () => {
    expect(await activateToolsAudit({ identifiers: ['builtin-artboard'] }, {})).toBe(true);
    expect(await activateToolsAudit({ identifiers: [] }, metadata)).toBe(true);
    expect(await activateToolsAudit({}, metadata)).toBe(true);
  });
});
