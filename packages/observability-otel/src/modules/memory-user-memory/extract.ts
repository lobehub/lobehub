import { metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-memory-user-memory-extraction');
export const tracer = trace.getTracer('@lobechat/memory-user-memory', '0.0.1');

export const processedSourceCounter = meter.createCounter(
  'server_services_memory_user_memory_extraction_processed_source',
  {
    description:
      'Count of memory extraction jobs processed per source and user with completion status.',
    unit: '{count}',
  },
);

export const processedDurationHistogram = meter.createHistogram(
  'server_services_memory_user_memory_extraction_processed_duration',
  {
    description: 'Duration of memory extraction jobs per source and user.',
    unit: 'ms',
  },
);

export const gateKeeperCallsCounter = meter.createCounter(
  'server_services_memory_user_memory_extraction_gate_keeper_calls',
  {
    description: 'Gate keeper invocation count by source, user, and status.',
    unit: '{count}',
  },
);

export const gateKeeperCallDurationHistogram = meter.createHistogram(
  'server_services_memory_user_memory_extraction_gate_keeper_call_duration',
  {
    description: 'Duration of gate keeper invocations by source, user, and status.',
    unit: 'ms',
  },
);

export const layersCallsCounter = meter.createCounter(
  'server_services_memory_user_memory_extraction_layers_calls',
  {
    description: 'Layer extractor invocation count by layer, source, user, and status.',
    unit: '{count}',
  },
);

export const layerCallDurationHistogram = meter.createHistogram(
  'server_services_memory_user_memory_extraction_layer_call_duration',
  {
    description: 'Duration of layer extractor calls by layer, source, user, and status.',
    unit: 'ms',
  },
);

export const layerEntriesHistogram = meter.createHistogram(
  'server_services_memory_user_memory_extraction_layer_entries',
  {
    description: 'Number of entries produced per layer extraction by source and user.',
    unit: '{count}',
  },
);
