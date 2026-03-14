export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEW_RELIC_ENABLED === 'true') {
    await import('./instrumentation.newrelic');
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
