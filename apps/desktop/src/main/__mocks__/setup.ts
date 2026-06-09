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
