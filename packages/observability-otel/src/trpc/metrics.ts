import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('trpc-server');

export const serverDurationHistogram = meter.createHistogram('rpc.server.duration', {
  description: 'Measures the duration of inbound RPC.',
  unit: 'ms',
});

export const serverRequestSizeHistogram = meter.createHistogram('rpc.server.request.size', {
  description: 'Measures the size of RPC request messages (uncompressed).',
  unit: 'By',
});

export const serverResponseSizeHistogram = meter.createHistogram('rpc.server.response.size', {
  description: 'Measures the size of RPC response messages (uncompressed).',
  unit: 'By',
});

export const serverRequestsPerRpcHistogram = meter.createHistogram('rpc.server.requests_per_rpc', {
  description: 'Measures the number of messages received per RPC.',
  unit: '{count}',
});

export const serverResponsesPerRpcHistogram = meter.createHistogram(
  'rpc.server.responses_per_rpc',
  {
    description: 'Measures the number of messages sent per RPC.',
    unit: '{count}',
  },
);
