#!/usr/bin/env bun
/**
 * E2E Test Environment Setup Script
 *
 * One-click setup for E2E testing environment.
 *
 * Usage:
 *   bun e2e/scripts/setup.ts [options]
 *
 * Options:
 *   --clean        Clean up existing containers and processes
 *   --skip-db      Skip database setup (use existing)
 *   --skip-migrate Skip database migration
 *   --build        Build the application before starting
 *   --start        Start the server after setup
 *   --port <port>  Server port (default: 3006)
 *   --help         Show help message
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  containerName: 'postgres-e2e',
  databaseDriver: 'node',
  databaseUrl: 'postgresql://postgres:postgres@localhost:5433/postgres',
  dbPort: 5433,
  defaultPort: 3006,
  dockerImage: 'paradedb/paradedb:latest',
  projectRoot: resolve(__dirname, '../..'),

  // S3 Mock (required even if not testing file uploads)
  s3Mock: {
    accessKeyId: 'e2e-mock-access-key',
    bucket: 'e2e-mock-bucket',
    endpoint: 'https://e2e-mock-s3.localhost',
    secretAccessKey: 'e2e-mock-secret-key',
  },

  // 2 minutes
  // Secrets (for e2e testing only)
  secrets: {
    betterAuthSecret: 'e2e-test-secret-key-for-better-auth-32chars!',
    keyVaultsSecret: 'LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s=',
  },

  serverTimeout: 120_000,
};

// ============================================================================
// Utilities
// ============================================================================

const colors = {
  cyan: (s: string) => `\u001B[36m${s}\u001B[0m`,
  dim: (s: string) => `\u001B[2m${s}\u001B[0m`,
  green: (s: string) => `\u001B[32m${s}\u001B[0m`,
  red: (s: string) => `\u001B[31m${s}\u001B[0m`,
  yellow: (s: string) => `\u001B[33m${s}\u001B[0m`,
};

function log(emoji: string, message: string) {
  console.log(`${emoji}  ${message}`);
}

function logStep(step: number, total: number, message: string) {
  console.log(`\n${colors.cyan(`[${step}/${total}]`)} ${message}`);
}

function exec(
  command: string,
  args: string[] = [],
  options: { cwd?: string; silent?: boolean } = {},
) {
  const { cwd = CONFIG.projectRoot, silent = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: true,
    stdio: silent ? 'pipe' : 'inherit',
  });
  return result;
}

function execAsync(
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: CONFIG.projectRoot,
      env: { ...process.env, ...env },
      shell: true,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(
  check: () => Promise<boolean>,
  timeout: number,
  interval: number = 1000,
  onWait?: () => void,
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await check()) {
      return true;
    }
    onWait?.();
    await sleep(interval);
  }
  return false;
}

// ============================================================================
// Docker Operations
// ============================================================================

function isDockerRunning(): boolean {
  const result = exec('docker', ['info'], { silent: true });
  return result.status === 0;
}

function isContainerRunning(name: string): boolean {
  const result = exec('docker', ['ps', '-q', '-f', `name=${name}`], { silent: true });
  return !!result.stdout?.trim();
}

function containerExists(name: string): boolean {
  const result = exec('docker', ['ps', '-aq', '-f', `name=${name}`], { silent: true });
  return !!result.stdout?.trim();
}

function stopContainer(name: string): void {
  if (isContainerRunning(name)) {
    log('🛑', `Stopping container: ${name}`);
    exec('docker', ['stop', name], { silent: true });
  }
}

function removeContainer(name: string): void {
  if (containerExists(name)) {
    log('🗑️ ', `Removing container: ${name}`);
    exec('docker', ['rm', name], { silent: true });
  }
}

async function startPostgres(): Promise<void> {
  // Check Docker is running
  if (!isDockerRunning()) {
    throw new Error('Docker is not running. Please start Docker Desktop first.');
  }

  if (isContainerRunning(CONFIG.containerName)) {
    log('✅', 'PostgreSQL container is already running');
    return;
  }

  // Remove existing container if exists
  removeContainer(CONFIG.containerName);

  log('🐘', 'Starting PostgreSQL container...');
  const result = exec('docker', [
    'run',
    '-d',
    '--name',
    CONFIG.containerName,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-p',
    `${CONFIG.dbPort}:5432`,
    CONFIG.dockerImage,
  ]);

  if (result.status !== 0) {
    throw new Error('Failed to start PostgreSQL container');
  }

  // Wait for database to be ready
  process.stdout.write('   Waiting for PostgreSQL to be ready');
  const isReady = await waitForCondition(
    async () => {
      const result = exec('docker', ['exec', CONFIG.containerName, 'pg_isready'], { silent: true });
      return result.status === 0;
    },
    30_000,
    2000,
    () => process.stdout.write('.'),
  );

  console.log();

  if (!isReady) {
    throw new Error('PostgreSQL failed to start within 30 seconds');
  }

  log('✅', 'PostgreSQL is ready');
}

// ============================================================================
// Process Management
// ============================================================================

function killProcessOnPort(port: number): void {
  const result = exec('lsof', ['-ti', `:${port}`], { silent: true });
  const pids = result.stdout?.trim();
  if (pids) {
    log('🔪', `Killing processes on port ${port}`);
    for (const pid of pids.split('\n')) {
      if (pid) {
        exec('kill', ['-9', pid], { silent: true });
      }
    }
  }
}

// ============================================================================
// Database Operations
// ============================================================================

async function runMigration(): Promise<void> {
  log('🔄', 'Running database migration...');

  await execAsync('bun', ['run', 'db:migrate'], {
    DATABASE_DRIVER: CONFIG.databaseDriver,
    DATABASE_URL: CONFIG.databaseUrl,
    KEY_VAULTS_SECRET: CONFIG.secrets.keyVaultsSecret,
  });

  log('✅', 'Database migration completed');
}

// ============================================================================
// Build Operations
// ============================================================================

async function buildApp(): Promise<void> {
  log('🔨', 'Building application (this may take a few minutes)...');

  await execAsync('bun', ['run', 'build'], {
    AUTH_SECRET: CONFIG.secrets.betterAuthSecret,
    DATABASE_DRIVER: CONFIG.databaseDriver,
    DATABASE_URL: CONFIG.databaseUrl,
    KEY_VAULTS_SECRET: CONFIG.secrets.keyVaultsSecret,
    SKIP_LINT: '1',
  });

  log('✅', 'Application built successfully');
}

// ============================================================================
// Server Operations
// ============================================================================

async function isServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/chat`, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

function getServerEnv(port: number): Record<string, string> {
  return {
    AUTH_EMAIL_VERIFICATION: '0',
    AUTH_SECRET: CONFIG.secrets.betterAuthSecret,
    DATABASE_DRIVER: CONFIG.databaseDriver,
    DATABASE_URL: CONFIG.databaseUrl,
    KEY_VAULTS_SECRET: CONFIG.secrets.keyVaultsSecret,
    NODE_OPTIONS: '--max-old-space-size=6144',
    PORT: String(port),
    S3_ACCESS_KEY_ID: CONFIG.s3Mock.accessKeyId,
    S3_BUCKET: CONFIG.s3Mock.bucket,
    S3_ENDPOINT: CONFIG.s3Mock.endpoint,
    S3_SECRET_ACCESS_KEY: CONFIG.s3Mock.secretAccessKey,
  };
}

async function startServer(port: number): Promise<void> {
  if (await isServerRunning(port)) {
    log('✅', `Server is already running on port ${port}`);
    return;
  }

  // Kill any process on the port first
  killProcessOnPort(port);

  log('🚀', `Starting server on port ${port}...`);

  const env = getServerEnv(port);

  // Start server in background
  const child = spawn('bunx', ['next', 'start', '-p', String(port)], {
    cwd: CONFIG.projectRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });

  child.unref();

  // Wait for server to be ready
  process.stdout.write('   Waiting for server to be ready');
  const isReady = await waitForCondition(
    () => isServerRunning(port),
    CONFIG.serverTimeout,
    2000,
    () => process.stdout.write('.'),
  );

  console.log();

  if (!isReady) {
    throw new Error(`Server failed to start within ${CONFIG.serverTimeout / 1000} seconds`);
  }

  log('✅', `Server is ready at http://localhost:${port}`);
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanup(): void {
  log('🧹', 'Cleaning up environment...');

  stopContainer(CONFIG.containerName);
  removeContainer(CONFIG.containerName);
  killProcessOnPort(3006);
  killProcessOnPort(3010);
  killProcessOnPort(5433);

  log('✅', 'Cleanup completed');
}

// ============================================================================
// CLI
// ============================================================================

function showHelp(): void {
  console.log(`
${colors.cyan('E2E Test Environment Setup Script')}

${colors.dim('Usage:')}
  bun e2e/scripts/setup.ts [options]

${colors.dim('Options:')}
  --clean        Clean up existing containers and processes
  --skip-db      Skip database setup (use existing)
  --skip-migrate Skip database migration
  --build        Build the application before starting
  --start        Start the server after setup
  --port <port>  Server port (default: ${CONFIG.defaultPort})
  --help         Show this help message

${colors.dim('Examples:')}
  ${colors.green('bun e2e/scripts/setup.ts')}                  # Setup DB only
  ${colors.green('bun e2e/scripts/setup.ts --start')}          # Setup DB and start server
  ${colors.green('bun e2e/scripts/setup.ts --build --start')}  # Full setup with build
  ${colors.green('bun e2e/scripts/setup.ts --clean')}          # Clean up environment

${colors.dim('After setup, run tests with:')}
  cd e2e
  BASE_URL=http://localhost:3006 bun run test
`);
}

interface Options {
  build: boolean;
  clean: boolean;
  help: boolean;
  port: number;
  skipDb: boolean;
  skipMigrate: boolean;
  start: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    build: false,
    clean: false,
    help: false,
    port: CONFIG.defaultPort,
    skipDb: false,
    skipMigrate: false,
    start: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h': {
        options.help = true;
        break;
      }
      case '--clean': {
        options.clean = true;
        break;
      }
      case '--skip-db': {
        options.skipDb = true;
        break;
      }
      case '--skip-migrate': {
        options.skipMigrate = true;
        break;
      }
      case '--build': {
        options.build = true;
        break;
      }
      case '--start': {
        options.start = true;
        break;
      }
      case '--port': {
        options.port = parseInt(args[++i], 10) || CONFIG.defaultPort;
        break;
      }
    }
  }

  return options;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`
${colors.cyan('🤯 LobeHub E2E Environment Setup')}
${'─'.repeat(50)}
`);

  try {
    if (options.clean) {
      cleanup();
      process.exit(0);
    }

    // Calculate total steps
    let totalSteps = 0;
    if (!options.skipDb) totalSteps++;
    if (!options.skipMigrate) totalSteps++;
    if (options.build) totalSteps++;
    if (options.start) totalSteps++;

    let currentStep = 0;

    // Step 1: Start database
    if (!options.skipDb) {
      logStep(++currentStep, totalSteps, 'Setting up PostgreSQL database');
      await startPostgres();
    }

    // Step 2: Run migration
    if (!options.skipMigrate) {
      logStep(++currentStep, totalSteps, 'Running database migrations');
      await runMigration();
    }

    // Step 3: Build (optional)
    if (options.build) {
      logStep(++currentStep, totalSteps, 'Building application');
      await buildApp();
    }

    // Step 4: Start server (optional)
    if (options.start) {
      logStep(++currentStep, totalSteps, 'Starting application server');
      await startServer(options.port);
    }

    console.log(`
${'─'.repeat(50)}
${colors.green('✅ E2E environment setup completed!')}
`);

    // Print next steps
    if (!options.start) {
      console.log(`${colors.dim('Next steps:')}`);
      console.log(`
  1. Start the server (in project root):
     ${colors.cyan(`bun e2e/scripts/setup.ts --start`)}

  2. Or start manually:
     ${colors.cyan(`bunx next start -p ${options.port}`)}
`);
    }

    console.log(`${colors.dim('Run tests:')}`);
    console.log(`
  cd e2e
  ${colors.cyan(`BASE_URL=http://localhost:${options.port} bun run test`)}

  ${colors.dim('# Debug mode (show browser)')}
  ${colors.cyan(`HEADLESS=false BASE_URL=http://localhost:${options.port} bun run test`)}
`);
  } catch (error) {
    console.error(`\n${colors.red('❌ Setup failed:')}`, error);
    process.exit(1);
  }
}

await main();
