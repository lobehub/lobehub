import type { BinarySpec } from '@/core/infrastructure/BinaryManager';
import { defineCommandBinary } from '@/core/infrastructure/BinaryManager';

/**
 * agent-browser — headless browser automation CLI for AI agents.
 *
 * Self-hosting: the desktop app downloads the GitHub release on first use
 * (lazy install). Users who installed via `npm i -g agent-browser`,
 * `brew install agent-browser`, or `cargo install agent-browser` keep using
 * their system copy — detect() reports those before the manager considers
 * downloading anything.
 *
 * https://github.com/vercel-labs/agent-browser
 */
export const agentBrowserBinary: BinarySpec = defineCommandBinary('agent-browser', {
  description: 'Vercel agent-browser - headless browser automation for AI agents',
  manage: {
    githubRepo: 'vercel-labs/agent-browser',
    pinnedVersion: '0.31.1',
    postInstall: [['install']],
    release: ({ arch, platform, version }) => {
      const platformSlug = ({ darwin: 'darwin', linux: 'linux', win32: 'win32' } as const)[
        platform as 'darwin' | 'linux' | 'win32'
      ];
      const archSlug = ({ arm64: 'arm64', x64: 'x64' } as const)[arch as 'arm64' | 'x64'];
      if (!platformSlug || !archSlug) {
        throw new Error(`agent-browser: unsupported platform '${platform}-${arch}'`);
      }
      const exe = platform === 'win32' ? '.exe' : '';
      return `https://github.com/vercel-labs/agent-browser/releases/download/v${version}/agent-browser-${platformSlug}-${archSlug}${exe}`;
    },
  },
  priority: 1,
});

export const browserAutomationBinaries: BinarySpec[] = [agentBrowserBinary];
