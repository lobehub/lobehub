import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';
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
  // A single leading separator is rooted on both platforms: POSIX absolute, or
  // a Windows drive-rooted path (`\Users\alice\report.md`) — Node's win32
  // `path.isAbsolute` treats the latter as absolute too, so never re-anchor it.
  // (`startsWith('\\')` also matches UNC's `\\` prefix, which is fine here.)
  filePath.startsWith('/') ||
  filePath.startsWith('\\') ||
  isHomeAnchoredPath(filePath) ||
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
 * Collapse a path to slash-separated segments with `.` / `..` resolved
 * lexically, so `/repo/sub/../report.md` compares as `/repo/report.md` instead
 * of prefix-matching `/repo/sub`. A `..` that would climb past the root is kept
 * (the resulting path can never match a real root, so containment fails —
 * the safe outcome). UNC roots keep their leading double slash.
 */
const normalizePathForContainment = (value: string): string => {
  const slashed = value.replaceAll('\\', '/');
  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const prefix = slashed.startsWith('//') ? '//' : slashed.startsWith('/') ? '/' : '';
  return prefix + segments.join('/');
};

/**
 * Windows-style (drive-letter or UNC) after slash normalization. Those
 * filesystems compare case-insensitively; POSIX paths must stay
 * case-sensitive (`/Repo` and `/repo` are different directories).
 */
const isWindowsStylePath = (normalized: string) =>
  /^[A-Z]:/i.test(normalized) || normalized.startsWith('//');

/**
 * Whether a resolved absolute path sits inside the working directory. Paths
 * outside it (e.g. an approved `/tmp/report.md` write) have no implicit preview
 * permission: the desktop preview manager rejects them unless the open carries
 * the explicit external-file allowance, and the device daemon enforces the cwd
 * boundary with no external mechanism at all. Purely lexical (separators and
 * dot segments normalized, no realpath), which matches how the daemon compares
 * roots.
 */
export const isWithinWorkingDirectory = (resolvedPath: string, workingDirectory: string) => {
  let file = normalizePathForContainment(resolvedPath);
  let root = normalizePathForContainment(workingDirectory);
  if (!root) return false;
  if (isWindowsStylePath(file) && isWindowsStylePath(root)) {
    file = file.toLowerCase();
    root = root.toLowerCase();
  }
  return file === root || file.startsWith(`${root}/`);
};

/**
 * A deleted file has nothing to preview on ANY transport (the sandbox read and
 * both filesystem hosts would all error) — the deletion diff stays the row's
 * primary action.
 */
export const canPreviewEditedFile = (entry: Pick<OperationEditedFile, 'kind'>) =>
  entry.kind !== 'deleted';

/**
 * Filesystem-leg open decision for a resolved entry path. Returns `undefined`
 * when the row must stay diff-only, otherwise the extra `openLocalFile` params:
 *
 * - UNC paths stay diff-only on the LOCAL desktop (the `localfile://` codec
 *   collapses UNC roots); a bound device serves them over RPC instead.
 * - Outside-cwd paths carry the explicit external allowance on desktop (same
 *   trust level as LocalFileLink clicks) and stay diff-only on a device — the
 *   portable daemon enforces the cwd boundary with no external mechanism.
 * - Home-anchored (`~`) paths can't be containment-checked lexically against
 *   an absolute cwd; the preview hosts expand `~` themselves, so defer to
 *   them: plain open on a device, external allowance on desktop in case the
 *   expansion lands outside the workspace.
 */
export const planFilesystemOpen = ({
  isDeviceMode,
  resolvedPath,
  workingDirectory,
}: {
  isDeviceMode: boolean;
  resolvedPath: string;
  workingDirectory: string;
}): { allowExternalFilePreview?: true } | undefined => {
  if (!isDeviceMode && isUncPath(resolvedPath)) return undefined;
  if (isWithinWorkingDirectory(resolvedPath, workingDirectory)) return {};
  if (isHomeAnchoredPath(resolvedPath)) {
    return isDeviceMode ? {} : { allowExternalFilePreview: true };
  }
  if (isDeviceMode) return undefined;
  return { allowExternalFilePreview: true };
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
  const isHetero = useCurrentAgentValue(agentProjectionSelectors.heterogeneous);
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
      if (!canPreviewEditedFile(entry)) return undefined;
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
      const plan = planFilesystemOpen({
        isDeviceMode: !!remoteDeviceId,
        resolvedPath,
        workingDirectory,
      });
      if (!plan) return undefined;
      return () =>
        openLocalFile({
          ...plan,
          deviceId: remoteDeviceId,
          filePath: resolvedPath,
          workingDirectory,
        });
    },
    [activeTopicId, filesystemAvailable, openLocalFile, remoteDeviceId, workingDirectory],
  );
};
