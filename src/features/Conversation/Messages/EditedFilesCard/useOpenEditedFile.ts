import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import type { OperationEditedFile } from './deriveEditedFiles';

// Home-relative paths are already anchored: the file tools expand exactly `~`,
// `~/…`, and `~\…` at write time (see local-file-shell's `expandTilde`). A
// first segment that merely STARTS with `~` (e.g. `~backup/report.md`) is NOT
// expanded there, so it is a valid cwd-relative path and must be anchored.
const isHomeAnchoredPath = (filePath: string) =>
  filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\');

// `~` and UNC (`\\server\share`) paths are already anchored — the file tools
// expand `~` at write time and UNC paths are absolute on Windows — so they
// must not be re-anchored to the working directory.
const isAbsolutePath = (filePath: string) =>
  filePath.startsWith('/') ||
  isHomeAnchoredPath(filePath) ||
  isUncPath(filePath) ||
  /^[A-Z]:[/\\]/i.test(filePath);

/**
 * The desktop `localfile://` codec collapses a UNC path's leading double
 * backslash (`\\server\share` → `\server\share`), so UNC entries would open a
 * broken preview on the local desktop — keep them diff-only there until the
 * protocol round trip preserves UNC roots. Windows accepts the forward-slash
 * form (`//server/share`) too, and it hits the same collapsing codec.
 */
export const isUncPath = (filePath: string) =>
  filePath.startsWith('\\\\') || filePath.startsWith('//');

/**
 * Shell-scan entries can carry workspace-relative paths (e.g. `deck.pptx` from
 * `marp -o deck.pptx`); both the desktop preview manager and the device-control
 * preview require absolute paths, so anchor relative ones to the working
 * directory before opening.
 */
export const resolveEntryPath = (entryPath: string, workingDirectory: string) =>
  isAbsolutePath(entryPath) ? entryPath : `${workingDirectory.replace(/[/\\]+$/, '')}/${entryPath}`;

/**
 * Whether a resolved absolute path sits inside the working directory. Paths
 * outside it (e.g. an approved `/tmp/report.md` write) have no implicit preview
 * permission: the desktop preview manager rejects them unless the open carries
 * the explicit external-file allowance, and the device daemon enforces the cwd
 * boundary with no external mechanism at all. Purely lexical (separators
 * normalized, no realpath), which matches how the daemon compares roots.
 */
export const isWithinWorkingDirectory = (resolvedPath: string, workingDirectory: string) => {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '');
  const file = normalize(resolvedPath);
  const root = normalize(workingDirectory);
  return file === root || file.startsWith(`${root}/`);
};

/**
 * Resolve a per-entry "open in portal" action for the edited-files card.
 *
 * Returns `undefined` when the entry has no reachable content — sandbox files
 * without an active topic, or filesystem files when neither the local desktop
 * nor a bound device can serve reads (mirrors the WorkingSidebar Files gate) —
 * so the row degrades to its diff-only affordance instead of a dead click.
 *
 * Context is resolved from the CURRENT agent config, not the round that ran:
 * best effort, matching how the files sidebar targets "where the agent works
 * now".
 */
export const useOpenEditedFile = () => {
  const [openLocalFile, activeTopicId] = useChatStore((s) => [s.openLocalFile, s.activeTopicId]);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(activeAgentId);
  const deviceRoutingAvailable = useIsGatewayModeEnabled(activeAgentId);

  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });
  const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
  const remoteDeviceId = isDeviceMode ? agencyConfig?.boundDeviceId : undefined;
  const filesystemAvailable = (effectiveTarget === 'local' && isDesktop) || isDeviceMode;

  return useCallback(
    (entry: OperationEditedFile): (() => void) | undefined => {
      if (entry.sandboxBacked) {
        if (!activeTopicId) return undefined;
        return () =>
          openLocalFile({
            filePath: entry.path,
            sandboxTopicId: activeTopicId,
            // Sandbox reads resolve paths inside the sandbox itself — there is
            // no client-side working directory to scope by.
            workingDirectory: '',
          });
      }

      if (!filesystemAvailable || !workingDirectory) return undefined;
      // Gate on the RESOLVED path: a relative entry inside a UNC workspace
      // resolves to a UNC path too.
      const resolvedPath = resolveEntryPath(entry.path, workingDirectory);
      if (!remoteDeviceId && isUncPath(resolvedPath)) return undefined;
      const withinCwd = isWithinWorkingDirectory(resolvedPath, workingDirectory);
      // Device daemons enforce the cwd boundary with no external-preview
      // allowance — an outside-cwd row would render the local-file error, so
      // keep it diff-only there. The local desktop supports the explicit
      // allowance (same trust level as LocalFileLink clicks on agent output).
      if (!withinCwd && remoteDeviceId) return undefined;
      return () =>
        openLocalFile({
          ...(withinCwd ? {} : { allowExternalFilePreview: true }),
          deviceId: remoteDeviceId,
          filePath: resolvedPath,
          workingDirectory,
        });
    },
    [activeTopicId, filesystemAvailable, openLocalFile, remoteDeviceId, workingDirectory],
  );
};
