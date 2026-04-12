export async function register() {
  // In local development, write debug logs to logs/server.log
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./libs/debug-file-logger');
  }

  // Auto-start GatewayManager / sync message-gateway connections on server start.
  // - Non-Vercel (Docker, local): always run — persistent bots need reconnection after restart.
  // - Vercel: only run when an external message gateway is configured, to sync connection state.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.DATABASE_URL &&
    (!process.env.VERCEL_ENV || process.env.MESSAGE_GATEWAY_URL)
  ) {
    const { GatewayService } = await import('./server/services/gateway');
    const service = new GatewayService();
    service.ensureRunning().catch((err) => {
      console.error('[Instrumentation] Failed to auto-start GatewayManager:', err);
    });
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.ENABLE_TELEMETRY_IN_DEV) {
    return;
  }

  const shouldEnable = process.env.ENABLE_TELEMETRY && process.env.NEXT_RUNTIME === 'nodejs';
  if (!shouldEnable) {
    return;
  }

  await import('./instrumentation.node');
}
