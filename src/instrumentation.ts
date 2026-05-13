export async function register() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // Auto-start GatewayManager on server start for non-Vercel production environments.
  // Persistent bots need reconnection after restart.
  // On Vercel, the cron job at /api/agent/gateway handles this reliably instead.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.DATABASE_URL &&
    !process.env.VERCEL_ENV
  ) {
    const { GatewayService } = await import('./server/services/gateway');
    const service = new GatewayService();
    service.ensureRunning().catch((err) => {
      console.error('[Instrumentation] Failed to auto-start GatewayManager:', err);
    });
  }

  // Note: messenger system bot connections (Discord/Telegram) are managed
  // entirely from dc-center's System Bots admin — save / enable / forceReconnect
  // mutations call MessageGateway directly. The main app's only role here is
  // to receive forwarded events at `/api/agent/messenger/webhooks/<platform>`,
  // which doesn't require any startup work.

  const shouldEnable = process.env.ENABLE_TELEMETRY && process.env.NEXT_RUNTIME === 'nodejs';
  if (!shouldEnable) {
    return;
  }

  await import('./instrumentation.node');
}
