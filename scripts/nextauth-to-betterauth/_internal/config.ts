import './env';

export type MigrationMode = 'test' | 'prod';
export type DatabaseDriver = 'neon' | 'node';

const DEFAULT_MODE: MigrationMode = 'test';
const DEFAULT_DATABASE_DRIVER: DatabaseDriver = 'neon';

export function getMigrationMode(): MigrationMode {
  const mode = process.env.NEXTAUTH_TO_BETTERAUTH_MODE;
  if (mode === 'test' || mode === 'prod') return mode;
  return DEFAULT_MODE;
}

export function getDatabaseUrl(mode = getMigrationMode()): string {
  const key =
    mode === 'test'
      ? 'TEST_NEXTAUTH_TO_BETTERAUTH_DATABASE_URL'
      : 'PROD_NEXTAUTH_TO_BETTERAUTH_DATABASE_URL';
  const value = process.env[key];

  if (!value) {
    throw new Error(`${key} is not set`);
  }

  return value;
}

export function getDatabaseDriver(): DatabaseDriver {
  const driver = process.env.NEXTAUTH_TO_BETTERAUTH_DATABASE_DRIVER;
  if (driver === 'neon' || driver === 'node') return driver;
  return DEFAULT_DATABASE_DRIVER;
}

export function getBatchSize(): number {
  return Number(process.env.NEXTAUTH_TO_BETTERAUTH_BATCH_SIZE) || 300;
}

export function isDryRun(): boolean {
  return process.argv.includes('--dry-run') || process.env.NEXTAUTH_TO_BETTERAUTH_DRY_RUN === '1';
}
