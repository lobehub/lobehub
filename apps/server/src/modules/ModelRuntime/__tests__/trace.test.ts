import { describe, expect, it, vi } from 'vitest';
import { createTraceOptions } from '../trace';
import { TraceClient } from '@/libs/traces';

vi.mock('@/libs/traces', () => {
  const generationMock = vi.fn().mockImplementation((genOptions) => ({
    id: 'mock-generation-id',
    update: vi.fn(),
    options: genOptions,
  }));

  const createTraceMock = vi.fn().mockImplementation((options) => ({
    id: 'mock-trace-id',
    generation: generationMock,
    update: vi.fn(),
    options,
  }));

  return {
    TraceClient: vi.fn().mockImplementation(() => ({
      createTrace: createTraceMock,
      shutdownAsync: vi.fn(),
    })),
  };
});

describe('createTraceOptions', () => {
  it('should separate object parameters from modelParameters and map to metadata', () => {
    const payload = {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 100,
      thinking: { mode: 'precise' },
      response_format: { type: 'json_object' },
    } as any;

    const options = {
      provider: 'openai',
      trace: {
        traceId: 'test-trace-id',
        traceName: 'test-trace-name',
      },
    } as any;

    createTraceOptions(payload, options);

    const traceClientInstance = new TraceClient();
    const mockCreateTrace = traceClientInstance.createTrace as any;

    expect(mockCreateTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-trace-id',
        metadata: expect.objectContaining({
          thinking: { mode: 'precise' },
          response_format: { type: 'json_object' },
          model: 'gpt-4o',
        }),
      })
    );

    const mockTrace = mockCreateTrace.mock.results[0].value;
    expect(mockTrace.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        metadata: expect.objectContaining({
          thinking: { mode: 'precise' },
          response_format: { type: 'json_object' },
        }),
        modelParameters: expect.objectContaining({
          temperature: 0.7,
          max_tokens: 100,
        }),
      })
    );

    const generationCallArgs = mockTrace.generation.mock.calls[0][0];
    expect(generationCallArgs.modelParameters.thinking).toBeUndefined();
    expect(generationCallArgs.modelParameters.response_format).toBeUndefined();
  });
});
