import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MacOSContentSearchImpl } from '../impl/macOS';
import { WindowsContentSearchImpl } from '../impl/windows';

/**
 * Runs the real Windows impl (real execa) on a non-Windows host, where neither
 * `where` nor `cmd` exists: the engine it would spawn is missing. That failure
 * used to resolve (execa `reject: false`) and come back as
 * `{ success: true, total_matches: 0 }` — indistinguishable from "no match".
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-win-silent-'));
const file = path.join(dir, 'SFSD_HMI_Demo_v3.html');
fs.writeFileSync(file, '<script>function gateLogin(){}</script>\n<p>点动</p>\n');

describe('WindowsContentSearchImpl does not swallow a missing engine', () => {
  it('control: macOS impl finds gateLogin in the same file', async () => {
    const r = await new MacOSContentSearchImpl().grep({
      output_mode: 'content',
      path: file,
      pattern: 'gateLogin',
    });
    expect(r.total_matches).toBe(1);
  });

  it('engine unavailable → must not be reported as 0 matches', async () => {
    const r = await new WindowsContentSearchImpl().grep({
      output_mode: 'content',
      pattern: 'gateLogin',
      scope: dir,
    });
    expect(r.success === false || r.total_matches > 0).toBe(true);
  });
});
