import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

let serverProcess: ChildProcess | null = null;
let serverStartPromise: Promise<void> | null = null;

// File-based lock to coordinate between parallel workers
const LOCK_FILE = resolve(__dirname, '../../.server-starting.lock');

export async function stopWebServer(): Promise<void> {
  if (serverProcess) {
    console.log('🛑 Stopping web server...');
    serverProcess.kill();
    serverProcess = null;
    serverStartPromise = null;
  }
  // Clean up lock file
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

interface WebServerOptions {
  command: string;
  env?: Record<string, string>;
  port: number;
  reuseExistingServer?: boolean;
  timeout?: number;
}

async function isServerRunning(port: number, timeoutMs = 2000): Promise<boolean> {
  const hosts = new Set(['127.0.0.1', '::1', 'localhost']);
  const envHost = process.env.HOST?.trim();
  if (envHost && envHost !== '0.0.0.0' && envHost !== '::') {
    hosts.add(envHost);
  }

  const tryConnect = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port });
      const timeoutId = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeoutMs);

      const finish = (result: boolean) => {
        clearTimeout(timeoutId);
        socket.destroy();
        resolve(result);
      };

      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });

  for (const host of hosts) {
    if (await tryConnect(host)) return true;
  }

  return false;
}

export async function startWebServer(options: WebServerOptions): Promise<void> {
  const { command, port, timeout = 30_000, env = {}, reuseExistingServer = true } = options;

  // If server is already being started by another worker, wait for it
  if (serverStartPromise) {
    console.log(`⏳ Waiting for server to start (started by another worker)...`);
    return serverStartPromise;
  }

  // Check if server is already running
  if (reuseExistingServer && (await isServerRunning(port))) {
    console.log(`✅ Reusing existing server on port ${port}`);
    return;
  }

  // Check if another worker is starting the server (file-based lock for cross-process coordination)
  if (existsSync(LOCK_FILE)) {
    console.log(`⏳ Another worker is starting the server, waiting...`);
    const startTime = Date.now();
    while (!(await isServerRunning(port))) {
      if (Date.now() - startTime > timeout) {
        // Lock file might be stale, try to clean up and proceed
        try {
          unlinkSync(LOCK_FILE);
        } catch {
          // Ignore
        }
        break;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
    if (await isServerRunning(port)) {
      console.log(`✅ Server is now ready on port ${port}`);
      return;
    }
  }

  // Create lock file to signal other workers
  try {
    writeFileSync(LOCK_FILE, String(process.pid));
  } catch {
    // Another worker might have created it, check again
    if (existsSync(LOCK_FILE)) {
      console.log(`⏳ Lock file created by another worker, waiting...`);
      const startTime = Date.now();
      while (!(await isServerRunning(port))) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Server failed to start within ${timeout}ms`);
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      }
      console.log(`✅ Server is now ready on port ${port}`);
      return;
    }
  }

  // Create a promise for the server startup and store it
  serverStartPromise = (async () => {
    console.log(`🚀 Starting web server: ${command}`);

    // Get the project root directory (parent of e2e folder)
    const projectRoot = resolve(__dirname, '../../..');

    const serverEnv = {
      ...process.env,
      // APP_URL is required for Better Auth to recognize localhost as a trusted origin
      APP_URL: `http://localhost:${port}`,
      // E2E test secret keys
      BETTER_AUTH_SECRET: 'e2e-test-secret-key-for-better-auth-32chars!',
      KEY_VAULTS_SECRET: 'LA7n9k3JdEcbSgml2sxfw+4TV1AzaaFU5+R176aQz4s=',
      // Disable email verification for e2e
      NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION: '0',
      // Enable Better Auth for e2e tests with real authentication
      NEXT_PUBLIC_ENABLE_BETTER_AUTH: '1',
      NODE_OPTIONS: '--max-old-space-size=6144',
      PORT: String(port),
      // Mock S3 env vars to prevent initialization errors
      S3_ACCESS_KEY_ID: 'e2e-mock-access-key',
      S3_BUCKET: 'e2e-mock-bucket',
      S3_ENDPOINT: 'https://e2e-mock-s3.localhost',
      S3_SECRET_ACCESS_KEY: 'e2e-mock-secret-key',
      ...env,
    };

    // Start the server process (spawn avoids maxBuffer limits)
    serverProcess = spawn(command, {
      cwd: projectRoot,
      env: serverEnv,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let startupError: Error | null = null;
    serverProcess.once('error', (error) => {
      startupError = error;
    });
    serverProcess.once('exit', (code, signal) => {
      startupError = new Error(
        `Server exited before ready (code: ${code ?? 'unknown'}, signal: ${signal ?? 'none'})`,
      );
    });

    // Forward server output to console for debugging
    serverProcess.stdout?.on('data', (data) => {
      console.log(`[server] ${data}`);
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error(`[server] ${data}`);
    });

    // Wait for server to be ready
    const startTime = Date.now();
    while (!(await isServerRunning(port))) {
      if (startupError) {
        throw startupError;
      }
      if (Date.now() - startTime > timeout) {
        throw new Error(`Server failed to start within ${timeout}ms`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }

    console.log(`✅ Web server is ready on port ${port}`);
  })().catch(async (error) => {
    serverStartPromise = null;
    try {
      unlinkSync(LOCK_FILE);
      await stopWebServer();
    } catch {
      // Ignore if file doesn't exist
    }
    throw error;
  });

  return serverStartPromise;
}

process.on('exit', () => {
  void stopWebServer();
});
