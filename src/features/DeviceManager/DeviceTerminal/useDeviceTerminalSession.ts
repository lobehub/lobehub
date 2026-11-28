import type { DeviceScope } from '@lobechat/types';
import { useCallback, useEffect, useState } from 'react';

import { DeviceTerminalSession } from '@/features/ChatTerminal/deviceTerminal';
import { xtermManager } from '@/features/ChatTerminal/xtermManager';

import { classifyTerminalOpenError, type TerminalOpenErrorKind } from './availability';

export type DeviceTerminalSessionState =
  | { status: 'idle' }
  | { status: 'opening' }
  | { sessionId: string; status: 'open' }
  | { status: 'exited' }
  | { error: TerminalOpenErrorKind; status: 'error' };

interface UseDeviceTerminalSessionParams {
  /** Directory the shell starts in; absent is the device user's home. */
  cwd?: string;
  deviceId: string;
  /** Open the shell only once the device can host it. */
  enabled: boolean;
  scope: DeviceScope;
}

/**
 * One interactive shell on a device, for as long as the panel showing it is
 * mounted. Leaving the page, switching tab or picking another directory ends
 * the shell on the device; so does closing the browser tab, through a
 * keepalive close sent on `pagehide`. A shell still being created when the panel
 * goes away is closed as soon as the device answers. A tab closed mid-create
 * may cancel that answer; such a shell is left to the device's idle sweep.
 */
export const useDeviceTerminalSession = ({
  cwd,
  deviceId,
  enabled,
  scope,
}: UseDeviceTerminalSessionParams) => {
  const [state, setState] = useState<DeviceTerminalSessionState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }

    let unmounted = false;
    let exited = false;
    // The page went away while the shell was still being created.
    let hidden = false;
    let session: DeviceTerminalSession | undefined;
    setState({ status: 'opening' });

    // A shell that exits at once can report it from the first read, before
    // `open` resolves and names the session; remember those exits.
    const exitedEarly = new Set<string>();
    const offExit = xtermManager.onSessionExit((sessionId) => {
      if (!session) {
        exitedEarly.add(sessionId);
        return;
      }
      if (sessionId !== session.sessionId) return;
      exited = true;
      setState({ status: 'exited' });
    });

    // The page is going away (tab closed, reload, navigation off the app):
    // React cleanup does not run then, so end the shell here.
    const onPageHide = () => {
      hidden = true;
      session?.disposeOnUnload();
    };
    // Restored from the back/forward cache: the shell was ended on the way out.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((value) => value + 1);
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    DeviceTerminalSession.open(deviceId, { cols: 80, cwd, rows: 24 }, { scope })
      .then((opened) => {
        session = opened;
        if (unmounted) {
          xtermManager.close(opened.sessionId);
          return;
        }
        // Answered after `pagehide` (the page is in the back/forward cache, or
        // the answer raced the unload): end it the same way.
        if (hidden) {
          opened.disposeOnUnload();
          return;
        }
        if (exitedEarly.has(opened.sessionId)) {
          exited = true;
          setState({ status: 'exited' });
          return;
        }
        setState({ sessionId: opened.sessionId, status: 'open' });
      })
      .catch((error) => {
        if (!unmounted) setState({ error: classifyTerminalOpenError(error), status: 'error' });
      });

    return () => {
      unmounted = true;
      offExit();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      if (!session) return;
      // An exited shell already dropped its view and routing; closing it through
      // the manager would fall back to this machine's own terminal.
      if (exited) void session.dispose();
      else xtermManager.close(session.sessionId);
    };
  }, [attempt, cwd, deviceId, enabled, scope]);

  /** End the current shell, if any, and open a fresh one. */
  const reopen = useCallback(() => setAttempt((value) => value + 1), []);

  return { reopen, state };
};
