/**
 * Vitest setup file for mocking native modules
 */
import { vi } from 'vitest';

// Mock node-mac-permissions before any imports
vi.mock('node-mac-permissions', () => import('./node-mac-permissions'));

// Default electron mock: gives every suite a ready `app` (paths + readiness)
// so modules with import-time electron access (e.g. `@/const/dir`) load safely
// without per-suite stubbing. A test's own `vi.mock('electron', …)` overrides
// this per-file.
vi.mock('electron', () => import('./electron'));

// The real logger pulls in electron-log + `@/env` at module scope and prints to
// the terminal. Every suite silenced it by hand; a suite asserting on log calls
// overrides this with its own `vi.mock('@/utils/logger', …)`.
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));
