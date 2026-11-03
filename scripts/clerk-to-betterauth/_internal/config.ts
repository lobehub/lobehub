import './env';

import type { ClerkToBetterAuthMode, DatabaseDriver } from './types';

const DEFAULT_MODE: ClerkToBetterAuthMode = 'test';
const DEFAULT_DATABASE_DRIVER: DatabaseDriver = 'neon';

export function getMigrationMode(): ClerkToBetterAuthMode {
  const mode = process.env.CLERK_TO_BETTERAUTH_MODE;
  if (mode === 'test' || mode === 'prod') return mode;
  return DEFAULT_MODE;
}

export function resolveDataPaths(mode = getMigrationMode()) {
  const baseDir = `scripts/clerk-to-betterauth/${mode}`;

  return {
    baseDir,
    clerkCsvPath: `${baseDir}/clerk_exported_users.csv`,
    clerkUsersPath: `${baseDir}/clerk_users.json`,
  } as const;
}

export function getDatabaseUrl(mode = getMigrationMode()): string {
  const key =
    mode === 'test'
      ? 'TEST_CLERK_TO_BETTERAUTH_DATABASE_URL'
      : 'PROD_CLERK_TO_BETTERAUTH_DATABASE_URL';
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is not set`);
  }

  return value;
}

export function getClerkSecret(mode = getMigrationMode()): string {
  const key =
    mode === 'test'
      ? 'TEST_CLERK_TO_BETTERAUTH_CLERK_SECRET_KEY'
      : 'PROD_CLERK_TO_BETTERAUTH_CLERK_SECRET_KEY';
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is required to export Clerk users`);
  }

  return value;
}

export function getDatabaseDriver(): DatabaseDriver {
  const driver = process.env.CLERK_TO_BETTERAUTH_DATABASE_DRIVER;
  if (driver === 'neon' || driver === 'node') return driver;
  return DEFAULT_DATABASE_DRIVER;
}
