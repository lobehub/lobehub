'use client';

import { type ErrorInfo, type ReactNode } from 'react';
import { Component } from 'react';

interface BootErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Number of hard reload attempts we should try before giving up.
   * Defaults to 1 to avoid reload loops.
   */
  maxBootReloads?: number;
}

interface BootErrorBoundaryState {
  hasError: boolean;
}

const DEFAULT_MAX_RELOADS = 1;
const RELOAD_SESSION_KEY = 'lobe:boot:hard-reload-attempts';
const FORCE_RELOAD_QUERY_KEY = '__lobe_force_reload';

/**
 * BootErrorBoundary guards the SPA bootstrap process. If we hit an error before
 * the first successful render, we force a one-time hard refresh to pull the
 * latest assets (similar to Cmd+Shift+R) to recover from cache mismatches.
 */
class BootErrorBoundary extends Component<BootErrorBoundaryProps, BootErrorBoundaryState> {
  public state: BootErrorBoundaryState = { hasError: false };

  private hasBooted = false;

  public componentDidMount() {
    this.hasBooted = true;
    this.resetReloadAttempts();
    this.cleanForceReloadMarker();
  }

  public static getDerivedStateFromError(): BootErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unexpected boot error captured by BootErrorBoundary', error, errorInfo);

    if (!this.hasBooted && this.tryHardReload()) {
      return;
    }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }

  private resetReloadAttempts() {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(RELOAD_SESSION_KEY);
    } catch (error) {
      // Access to sessionStorage can fail in restricted environments; ignore.
      if (process.env.NODE_ENV === 'development') {
        console.warn('BootErrorBoundary failed to reset reload attempts', error);
      }
    }
  }

  private tryHardReload() {
    if (typeof window === 'undefined') return false;

    try {
      const maxReloads = this.props.maxBootReloads ?? DEFAULT_MAX_RELOADS;
      const attempts = Number(window.sessionStorage.getItem(RELOAD_SESSION_KEY) ?? '0');
      const href = window.location.href;

      if (attempts >= maxReloads) {
        console.warn('BootErrorBoundary reached max reload attempts', {
          attempts,
          href,
          maxReloads,
        });
        return false;
      }

      console.info('BootErrorBoundary forcing hard reload', { attempts, href, maxReloads });
      window.sessionStorage.setItem(RELOAD_SESSION_KEY, String(attempts + 1));
    } catch (error) {
      // If sessionStorage is unavailable, we still attempt a reload once.
      if (process.env.NODE_ENV === 'development') {
        console.warn('BootErrorBoundary failed to persist reload attempts', error);
      }
    }

    this.forceHardReload();
    return true;
  }

  private forceHardReload() {
    const { location } = window;

    // Append a cache-busting query parameter so the browser bypasses cached assets.
    const url = new URL(location.href);
    url.searchParams.set(FORCE_RELOAD_QUERY_KEY, Date.now().toString());

    location.replace(url.toString());
  }

  private cleanForceReloadMarker() {
    if (typeof window === 'undefined') return;
    const { history, location } = window;

    const url = new URL(location.href);

    if (!url.searchParams.has(FORCE_RELOAD_QUERY_KEY)) return;

    url.searchParams.delete(FORCE_RELOAD_QUERY_KEY);
    history.replaceState(history.state, '', url.toString());
  }
}

export default BootErrorBoundary;
