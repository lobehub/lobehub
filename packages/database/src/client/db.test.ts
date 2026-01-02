import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn(() => ({})),
}));

vi.mock('@electric-sql/pglite/vector', () => ({
  vector: vi.fn(),
}));

vi.mock('drizzle-orm/pglite', () => ({
  drizzle: vi.fn(() => ({
    dialect: {
      migrate: vi.fn().mockResolvedValue(undefined),
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('DatabaseManager', () => {
  describe('initializeDB', () => {
    it('should initialize database with PGlite', async () => {
      const { initializeDB } = await import('./db');
      await initializeDB();

      expect(PGlite).toHaveBeenCalledWith('idb://lobechat', {
        extensions: { vector: expect.any(Function) },
        relaxedDurability: true,
      });
    });

    it('should only initialize once when called multiple times', async () => {
      const { initializeDB } = await import('./db');
      await Promise.all([initializeDB(), initializeDB()]);

      expect(PGlite).toHaveBeenCalledTimes(1);
    });
  });

  describe('clientDB proxy', () => {
    it('should provide access to database after initialization', async () => {
      const { clientDB, initializeDB } = await import('./db');
      await initializeDB();
      expect(clientDB).toBeDefined();
    });
  });
});
