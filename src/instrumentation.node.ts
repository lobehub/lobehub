import { register } from '@lobechat/observability-otel/node';

import { getLangfuseSpanProcessor } from '@/libs/traces';

import { version } from '../package.json';

const telemetryEnabled = !!(
  process.env.ENABLE_TELEMETRY &&
  (process.env.NODE_ENV === 'production' || process.env.ENABLE_TELEMETRY_IN_DEV)
);
const langfuseSpanProcessor = getLangfuseSpanProcessor();

register({
  autoInstrumentations: telemetryEnabled,
  otlp: telemetryEnabled,
  spanProcessors: langfuseSpanProcessor ? [langfuseSpanProcessor] : [],
  version,
});
