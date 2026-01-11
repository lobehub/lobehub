/**
 * Vitest setup file for mocking native modules
 */

import { vi } from 'vitest';

// Mock node-mac-permissions before any imports
vi.mock('node-mac-permissions', () => import('./node-mac-permissions'));
