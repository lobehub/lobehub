import { homedir, platform } from 'node:os';
import path from 'node:path';

import type { LocalHeterogeneousAgentType } from '../config';

// Well-known absolute install locations probed when a bare command isn't on
// PATH. This covers GUI-launched apps with a lean launchd PATH: Claude's
// official installer can put `claude` under ~/.local/bin, while the Codex
// desktop app bundles a functional CLI inside its app bundle without symlinking it.
export const getWellKnownCommandPaths = (agentType: LocalHeterogeneousAgentType): string[] => {
  switch (agentType) {
    case 'amp': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'amp'),
        path.join(homedir(), '.amp', 'bin', 'amp'),
        path.join(homedir(), '.bun', 'bin', 'amp'),
        path.join(homedir(), '.npm-global', 'bin', 'amp'),
        path.join(homedir(), 'Library', 'pnpm', 'amp'),
      ];
    }
    case 'claude-code': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'claude'),
        path.join(homedir(), '.bun', 'bin', 'claude'),
        path.join(homedir(), '.npm-global', 'bin', 'claude'),
        path.join(homedir(), 'Library', 'pnpm', 'claude'),
      ];
    }
    case 'codebuddy': {
      if (platform() === 'win32') {
        return [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'codebuddy.cmd')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'codebuddy'),
        path.join(homedir(), '.bun', 'bin', 'codebuddy'),
        path.join(homedir(), '.npm-global', 'bin', 'codebuddy'),
        path.join(homedir(), 'Library', 'pnpm', 'codebuddy'),
      ];
    }
    case 'codex': {
      // The Windows Codex desktop app (MSIX package `OpenAI.Codex`) drops its
      // bundled CLI here and adds the directory to the registry User PATH —
      // which an already-running process never sees. Same scenario the
      // macOS app-bundle probe below covers: "installed the app, never
      // installed the CLI".
      if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return [];

        return [
          path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
          // winget installs expose a stable `Links` shim alongside the package.
          path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'codex.exe'),
        ];
      }

      if (platform() !== 'darwin') return [];

      // Codex.app was renamed to ChatGPT.app. ChatGPT.app 26.9 then moved the
      // CLI from `Resources/codex` into a self-contained `Resources/codex-cli/`
      // package whose `codex-package.json` declares `bin/codex` as the
      // entrypoint. Probe newest first; legacy Codex.app only ever shipped the
      // flat binary.
      return [
        path.join('ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'),
        path.join('ChatGPT.app', 'Contents', 'Resources', 'codex'),
        path.join('Codex.app', 'Contents', 'Resources', 'codex'),
      ].flatMap((bundledCli) => [
        path.join('/Applications', bundledCli),
        path.join(homedir(), 'Applications', bundledCli),
      ]);
    }
    case 'cursor': {
      if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return [];

        return [
          path.win32.join(localAppData, 'cursor-agent', 'agent.cmd'),
          path.win32.join(localAppData, 'cursor-agent', 'cursor-agent.cmd'),
        ];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [
        path.join(homedir(), '.local', 'bin', 'agent'),
        // Cursor's installer creates both names. Keep the unambiguous legacy
        // alias as a fallback when another CLI shadows the generic `agent`.
        path.join(homedir(), '.local', 'bin', 'cursor-agent'),
      ];
    }
    case 'droid': {
      if (platform() === 'win32') {
        return [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'droid.cmd')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'droid'),
        path.join(homedir(), '.bun', 'bin', 'droid'),
        path.join(homedir(), '.npm-global', 'bin', 'droid'),
        path.join(homedir(), 'Library', 'pnpm', 'droid'),
      ];
    }
    case 'devin': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [path.join(homedir(), '.local', 'bin', 'devin')];
    }
    case 'grok-build': {
      if (platform() === 'win32') {
        return [path.join(homedir(), '.grok', 'bin', 'grok.exe')];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [path.join(homedir(), '.grok', 'bin', 'grok')];
    }
    case 'kimi-code': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];
      return [
        path.join(homedir(), '.kimi-code', 'bin', 'kimi'),
        path.join(homedir(), '.local', 'bin', 'kimi'),
        path.join(homedir(), '.bun', 'bin', 'kimi'),
        path.join(homedir(), '.npm-global', 'bin', 'kimi'),
        path.join(homedir(), 'Library', 'pnpm', 'kimi'),
      ];
    }
    case 'opencode': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.opencode', 'bin', 'opencode'),
        path.join(homedir(), '.local', 'bin', 'opencode'),
        path.join(homedir(), '.bun', 'bin', 'opencode'),
        path.join(homedir(), '.npm-global', 'bin', 'opencode'),
        path.join(homedir(), 'Library', 'pnpm', 'opencode'),
      ];
    }
    case 'pi': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'pi'),
        path.join(homedir(), '.npm-global', 'bin', 'pi'),
        path.join(homedir(), 'Library', 'pnpm', 'pi'),
      ];
    }
    case 'qoder': {
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'qodercli'),
        path.join(homedir(), '.bun', 'bin', 'qodercli'),
        path.join(homedir(), '.npm-global', 'bin', 'qodercli'),
        path.join(homedir(), 'Library', 'pnpm', 'qodercli'),
      ];
    }
    case 'trae': {
      if (platform() === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) return [];

        const currentBinDir = path.win32.join(localAppData, 'Programs', 'TraeCLI', 'bin');
        const legacyBinDir = path.win32.join(localAppData, 'trae-cli', 'bin');
        return [
          path.win32.join(currentBinDir, 'traex.exe'),
          path.win32.join(legacyBinDir, 'traecli.exe'),
          path.win32.join(legacyBinDir, 'trae-cli.exe'),
        ];
      }
      if (platform() !== 'darwin' && platform() !== 'linux') return [];

      return [
        path.join(homedir(), '.local', 'bin', 'traecli'),
        path.join(homedir(), '.local', 'bin', 'trae-cli'),
      ];
    }
    default: {
      return [];
    }
  }
};
