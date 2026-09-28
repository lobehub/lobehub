import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AGENT_BROWSER_PINNED_VERSION, systemPrompt } from './content';

/**
 * The desktop app downloads agent-browser lazily and a failed download only logs
 * a warning, and gateway devices may never have it at all — the skill is still
 * offered. The instructions must not promise the CLI is there, and the `npx`
 * fallback must run the same version the desktop app pins.
 */
describe('agent-browser skill content', () => {
  it('does not claim agent-browser or Chrome is pre-installed', () => {
    expect(systemPrompt).not.toMatch(/pre-installed/i);
    expect(systemPrompt).not.toMatch(/no setup needed/i);
  });

  it('tells the model to check for the CLI and fall back to a pinned npx run', () => {
    expect(systemPrompt).toContain('command -v agent-browser');
    expect(systemPrompt).toContain(`npx -y agent-browser@${AGENT_BROWSER_PINNED_VERSION}`);
  });

  // Windows commands usually run in PowerShell, where a bare `where` is the
  // Where-Object alias and finds nothing even when the binary is installed.
  it('probes Windows with where.exe, which works in both cmd and PowerShell', () => {
    expect(systemPrompt).toContain('where.exe agent-browser');
    expect(systemPrompt).not.toMatch(/^where agent-browser/m);
  });

  it('gives a Chrome launch command for each desktop platform', () => {
    expect(systemPrompt).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(systemPrompt).toContain('google-chrome');
    expect(systemPrompt).toMatch(/chrome\.exe/);
  });

  it('pins the same agent-browser version the desktop app downloads', () => {
    const desktopSpec = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../apps/desktop/src/main/modules/binaries/agentBrowserBinaries.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const desktopVersion = desktopSpec.match(/pinnedVersion:\s*'([^']+)'/)?.[1];

    expect(desktopVersion).toBeDefined();
    expect(AGENT_BROWSER_PINNED_VERSION).toBe(desktopVersion);
  });
});
