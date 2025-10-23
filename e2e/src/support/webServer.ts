import { type ChildProcess, exec } from 'node:child_process';
import { resolve } from 'node:path';

let serverProcess: ChildProcess | null = null;
let serverStartPromise: Promise<void> | null = null;

interface WebServerOptions {
  command: string;
  env?: Record<string, string>;
  port: number;
  reuseExistingServer?: boolean;
  timeout?: number;
}

async function isServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/chat`, {
      method: 'HEAD',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startWebServer(options: WebServerOptions): Promise<void> {
  const { command, port, timeout = 120_000, env = {}, reuseExistingServer = true } = options;

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

  // Create a promise for the server startup and store it
  serverStartPromise = (async () => {
    console.log(`🚀 Starting web server: ${command}`);

    // Get the project root directory (parent of e2e folder)
    const projectRoot = resolve(__dirname, '../../..');

    // Start the server process
    serverProcess = exec(command, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ENABLE_AUTH_PROTECTION: '0',
        ENABLE_OIDC: '0',
        NEXT_PUBLIC_ENABLE_CLERK_AUTH: '0',
        NEXT_PUBLIC_ENABLE_NEXT_AUTH: '0',
        NODE_OPTIONS: '--max-old-space-size=6144',
        PORT: String(port),
        ...env,
      },
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
      if (Date.now() - startTime > timeout) {
        throw new Error(`Server failed to start within ${timeout}ms`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }

    console.log(`✅ Web server is ready on port ${port}`);
  })();

  return serverStartPromise;
}

export async function stopWebServer(): Promise<void> {
  if (serverProcess) {
    console.log('🛑 Stopping web server...');
    serverProcess.kill();
    serverProcess = null;
    serverStartPromise = null;
  }
}
