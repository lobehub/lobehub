import { describe, expectTypeOf, it } from 'vitest';

import type { PipelineContext, PipelineContextMetadata } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    customMetadata?: {
      enabled: boolean;
      source: 'test';
    };
  }
}

describe('PipelineContextMetadata', () => {
  it('should keep built-in metadata fields strongly typed', () => {
    expectTypeOf<PipelineContextMetadata['historySummary']>().toEqualTypeOf<
      | {
          formattedLength: number;
          injected: boolean;
          originalLength: number;
        }
      | undefined
    >();
    expectTypeOf<PipelineContextMetadata['toolMessageReorder']>().toEqualTypeOf<
      | {
          originalCount: number;
          removedInvalidTools: number;
          reorderedCount: number;
        }
      | undefined
    >();
  });

  it('should support template literal injected-count metadata keys', () => {
    expectTypeOf<PipelineContextMetadata['CustomProviderInjectedCount']>().toEqualTypeOf<
      number | undefined
    >();
  });

  it('should expose consumer-side metadata extensions through pipeline context', () => {
    expectTypeOf<PipelineContext['metadata']['customMetadata']>().toEqualTypeOf<
      | {
          enabled: boolean;
          source: 'test';
        }
      | undefined
    >();
  });
});
