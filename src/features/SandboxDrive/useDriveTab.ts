import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The drive tab the storage page has open, kept in `?drive=public|personal` so
 * it survives a reload and can be linked. A value naming a drive the caller
 * does not have falls back to the first one offered.
 */
export const useDriveTab = (drives: SandboxDrive[]) => {
  const [params, setParams] = useSearchParams();
  const requested = params.get('drive') as SandboxDrive | null;
  const active = requested && drives.includes(requested) ? requested : drives[0];

  const setActive = useCallback(
    (drive: SandboxDrive) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('drive', drive);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return [active, setActive] as const;
};

export type DriveView = 'cleanup' | 'files';

/**
 * Which view of the drive is open — its files, or the space analysis and
 * cleanup — kept in `?view=cleanup` so a quota refusal elsewhere can link
 * straight to it.
 */
export const useDriveView = () => {
  const [params, setParams] = useSearchParams();
  const view: DriveView = params.get('view') === 'cleanup' ? 'cleanup' : 'files';

  const setView = useCallback(
    (next: DriveView) =>
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === 'cleanup') updated.set('view', 'cleanup');
          else updated.delete('view');
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );

  return [view, setView] as const;
};
