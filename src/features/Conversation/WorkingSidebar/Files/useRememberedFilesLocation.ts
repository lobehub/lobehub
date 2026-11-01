import { useEffect, useMemo, useRef } from 'react';

import { cacheScope } from '@/libs/replica';
import { useIsScopeTrusted } from '@/libs/swr/useCacheScope';
import {
  type FilesLocation,
  peekFilesLocation,
  projectFileActions,
  useProjectFileStore,
} from '@/store/projectFile';

export type { FilesLocation } from '@/store/projectFile';

/** The live resolution can know the host before it knows the directory. */
export interface ResolvedFilesLocation {
  deviceId?: string;
  directory?: string;
}

/**
 * The conversation a remembered location belongs to. `/` rather than `:` keeps
 * the replica's own SWR keys clear of the `topic:` / `agent:` prefixes the SWR
 * persistent cache matches by substring, so the row is stored once, here.
 */
export const filesLocationContextKey = (
  topicId: string | null | undefined,
  agentId: string | null | undefined,
): string | undefined => (topicId ? `topic/${topicId}` : agentId ? `agent/${agentId}` : undefined);

/**
 * The Files tree's directory, stable across a cold start.
 *
 * Until the device list arrives the working directory cannot be resolved for
 * real: a device default is unknown, so it reads as the home fallback (desktop)
 * or nothing (web) and then jumps. The tree is keyed by that directory, so the
 * jump meant reading the wrong tree first — or hiding the tab — and the saved
 * tree for the right one never got a chance to paint. Until `settled`, the
 * directory this conversation resolved to last time (the `filesLocation`
 * replica) stands in; once settled, the live resolution wins and is remembered
 * for next time.
 */
export const useRememberedFilesLocation = (
  contextKey: string | undefined,
  resolved: ResolvedFilesLocation | undefined,
  settled: boolean,
): FilesLocation | undefined => {
  const scope = cacheScope.use();
  const params = useMemo(() => (contextKey ? { contextKey } : null), [contextKey]);
  const stored = useProjectFileStore((s) => (contextKey ? s.filesLocation[contextKey] : undefined));
  projectFileActions.useFetchFilesLocation(params);
  // Until the replica has hydrated the entry, its row is read here so the
  // first frame already opens the saved tree.
  const peeked = useMemo(
    () => (contextKey && !stored ? peekFilesLocation(contextKey, scope) : undefined),
    [contextKey, scope, stored],
  );
  const remembered = stored ?? peeked;
  const scopeTrusted = useIsScopeTrusted();
  const wasTrusted = useRef(scopeTrusted);

  const resolvedDirectory = resolved?.directory;
  const resolvedDeviceId = resolved?.deviceId;
  useEffect(() => {
    const trustJustResolved = scopeTrusted && !wasTrusted.current;
    wasTrusted.current = scopeTrusted;
    // Before identity resolves the engine drops the write; the value still
    // lands in memory, so the equality check below would otherwise keep the
    // row out of storage for the rest of the session.
    if (!scopeTrusted) return;
    if (!contextKey || !settled || resolvedDirectory === undefined) return;
    if (
      !trustJustResolved &&
      remembered?.directory === resolvedDirectory &&
      remembered?.deviceId === resolvedDeviceId
    )
      return;
    projectFileActions.rememberFilesLocation(contextKey, {
      deviceId: resolvedDeviceId,
      directory: resolvedDirectory,
    });
  }, [contextKey, remembered, resolvedDeviceId, resolvedDirectory, scopeTrusted, settled]);

  if (settled) {
    return resolvedDirectory === undefined
      ? undefined
      : { deviceId: resolvedDeviceId, directory: resolvedDirectory };
  }
  // The live host is already known from the agent's config before the device
  // list settles. A tree saved on another machine must not stand in for it, or
  // the pane would read and mutate the previously bound host until then.
  if (remembered && remembered.deviceId !== resolvedDeviceId) {
    return resolvedDirectory === undefined
      ? undefined
      : { deviceId: resolvedDeviceId, directory: resolvedDirectory };
  }
  if (remembered) return remembered;
  return resolvedDirectory === undefined
    ? undefined
    : { deviceId: resolvedDeviceId, directory: resolvedDirectory };
};
