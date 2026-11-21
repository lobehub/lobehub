import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { INSTALL_RESULT_PARAMS } from './connectorPage';

export interface InstallResult {
  account: string | null;
  error: string | null;
  installed: string | null;
  pending: string | null;
}

/**
 * Hands an install callback's result to `report`, once, and clears it. Goes
 * through the router so the page's own params (the open Marketplace detail)
 * and history state survive.
 */
export const useInstallResult = (ready: boolean, report: (result: InstallResult) => void) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state } = useLocation();
  const handled = useRef<string>(undefined);

  const installed = searchParams.get('installed');
  const error = searchParams.get('error');
  const account = searchParams.get('account');
  const pending = searchParams.get('pending');

  useEffect(() => {
    if (!installed && !error && !pending) {
      // Cleared: the same outcome from a later install is a new report.
      handled.current = undefined;
      return;
    }
    if (!ready) return;
    const result = JSON.stringify([installed, error, account, pending]);
    if (handled.current === result) return;
    handled.current = result;

    report({ account, error, installed, pending });

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of INSTALL_RESULT_PARAMS) next.delete(key);
        return next;
      },
      { replace: true, state },
    );
  }, [account, error, installed, pending, ready, report, setSearchParams, state]);
};
