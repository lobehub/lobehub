import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryExtractionJob, MemoryExtractionServiceOptions } from '../extractExecutor';
import { MemoryExtractionService } from '../extractExecutor';

// Mock the observability modules
vi.mock('@lobechat/observability-otel/modules/memory-user-memory', () => ({
  gateKeeperCallDurationHistogram: { record: vi.fn() },
  gateKeeperCallsCounter: { add: vi.fn() },
  layerCallDurationHistogram: { record: vi.fn() },
  layersCallsCounter: { add: vi.fn() },
  tracer: {
    startActiveSpan: (_name: string, _attrs: any, fn: any) => {
      const span = {
        end: vi.fn(),
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        spanContext: () => ({ spanId: 'test', traceId: 'test' }),
      };
      return fn(span);
    },
  },
}));

vi.mock('@lobechat/observability-otel/node', () => ({
  attributesCommon: () => ({}),
}));

// Mock the extractors
vi.mock('../extractors', () => {
  const mockExtractor = {
    structuredCall: vi.fn().mockResolvedValue({ entries: [], summary: 'mock' }),
  };

  return {
    ActivityExtractor: vi.fn().mockImplementation(() => mockExtractor),
    ContextExtractor: vi.fn().mockImplementation(() => mockExtractor),
    ExperienceExtractor: vi.fn().mockImplementation(() => mockExtractor),
    IdentityExtractor: vi.fn().mockImplementation(() => mockExtractor),
    PreferenceExtractor: vi.fn().mockImplementation(() => mockExtractor),
    UserMemoryGateKeeper: vi.fn().mockImplementation(() => ({
      check: vi.fn().mockResolvedValue({
        activity: { shouldExtract: true },
        context: { shouldExtract: true },
        experience: { shouldExtract: true },
        identity: { shouldExtract: true },
        preference: { shouldExtract: true },
      }),
    })),
  };
});

const createMockOptions = (): MemoryExtractionServiceOptions => ({
  config: {
    gateModel: 'gatekeeper-model',
    layerModels: {
      activity: 'activity-model',
      context: 'context-model',
      experience: 'experience-model',
      identity: 'identity-model',
      preference: 'preference-model',
    },
  },
  db: {} as any,
  runtimes: {
    gatekeeper: {} as any,
    layerExtractor: {} as any,
  },
});

const createMockJob = (layers?: LayersEnum[]): MemoryExtractionJob => ({
  force: false,
  layers,
  source: MemorySourceType.ChatTopic,
  sourceId: 'topic-123',
  userId: 'user-123',
});

describe('MemoryExtractionService layer execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('sequential execution', () => {
    it('should execute layers sequentially (not in parallel)', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: string[] = [];

      // Mock runLayer to track execution order
      const originalRunLayer = (service as any).runLayer.bind(service);
      (service as any).runLayer = vi.fn(async function* (job: any, layer: LayersEnum) {
        executionOrder.push(layer);
        return { entries: [], summary: `mock ${layer}` };
      });

      // Actually, runLayer returns a promise, let me re-check
      // Let me just mock it properly
      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) =>
          new Promise((resolve) => {
            executionOrder.push(`${layer}-start`);
            setTimeout(() => {
              executionOrder.push(`${layer}-end`);
              resolve({ entries: [], summary: `mock ${layer}` });
            }, 10);
          }),
      );

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Preference,
        LayersEnum.Identity,
      ];

      const resultPromise = (service as any).runLayers(
        createMockJob(allLayers),
        allLayers,
        {},
      );

      // Advance through all layers
      await vi.advanceTimersByTimeAsync(200);
      await resultPromise;

      // Verify sequential: each layer starts after previous ends
      // Activity-start, Activity-end, Context-start, Context-end, ...
      const startIndices = executionOrder
        .filter((s) => s.endsWith('-start'))
        .map((s) => executionOrder.indexOf(s));
      const endIndices = executionOrder
        .filter((s) => s.endsWith('-end'))
        .map((s) => executionOrder.indexOf(s));

      // Each layer's start should come after the previous layer's end
      for (let i = 1; i < startIndices.length; i++) {
        expect(startIndices[i]).toBeGreaterThan(endIndices[i - 1]);
      }
    });

    it('should execute layers in order: Activity, Context, Experience, Preference, Identity', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Preference,
        LayersEnum.Identity,
      ];

      await (service as any).runLayers(createMockJob(allLayers), allLayers, {});

      expect(executionOrder).toEqual([
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Preference,
        LayersEnum.Identity,
      ]);
    });

    it('should skip layers not in the requested layers list', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      // Only request Activity and Identity
      const requestedLayers = [LayersEnum.Activity, LayersEnum.Identity];

      await (service as any).runLayers(
        createMockJob(requestedLayers),
        requestedLayers,
        {},
      );

      expect(executionOrder).toEqual([LayersEnum.Activity, LayersEnum.Identity]);
    });
  });

  describe('error handling', () => {
    it('should continue processing remaining layers if one layer fails', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          if (layer === LayersEnum.Context) {
            return Promise.reject(new Error('context extraction failed'));
          }
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
      ];

      const result = await (service as any).runLayers(
        createMockJob(allLayers),
        allLayers,
        {},
      );

      // All layers should have been attempted
      expect(executionOrder).toEqual([
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
      ]);

      // Context should have an error
      expect(result.context).toHaveProperty('error');
      // Activity should have data
      expect(result.activity).toHaveProperty('data');
      // Experience should have data
      expect(result.experience).toHaveProperty('data');
    });

    it('should capture errors in layer output', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const error = new Error('extraction failed');

      (service as any).runLayer = vi.fn().mockRejectedValue(error);

      const allLayers = [LayersEnum.Activity];

      const result = await (service as any).runLayers(
        createMockJob(allLayers),
        allLayers,
        {},
      );

      expect(result.activity).toEqual({ error });
    });
  });

  describe('gateKeeper filtering', () => {
    it('should skip layers where gateKeeper returns shouldExtract=false', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      // Mock gateKeeper to skip context and preference
      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: true },
          context: { shouldExtract: false },
          experience: { shouldExtract: true },
          identity: { shouldExtract: false },
          preference: { shouldExtract: false },
        }),
      };

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Identity,
        LayersEnum.Preference,
      ];

      await (service as any).run(
        createMockJob(allLayers),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      // Only activity and experience should be executed
      expect(executionOrder).toEqual([LayersEnum.Activity, LayersEnum.Experience]);
    });

    it('should skip all layers when gateKeeper returns shouldExtract=false for all', async () => {
      const service = new MemoryExtractionService(createMockOptions());

      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: false },
          context: { shouldExtract: false },
          experience: { shouldExtract: false },
          identity: { shouldExtract: false },
          preference: { shouldExtract: false },
        }),
      };

      const runLayerSpy = vi.fn();
      (service as any).runLayer = runLayerSpy;

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Identity,
        LayersEnum.Preference,
      ];

      const result = await (service as any).run(
        createMockJob(allLayers),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      // No layers should be executed
      expect(runLayerSpy).not.toHaveBeenCalled();
      expect(result.layers).toEqual([]);
    });

    it('should execute all layers when gateKeeper returns shouldExtract=true for all', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: true },
          context: { shouldExtract: true },
          experience: { shouldExtract: true },
          identity: { shouldExtract: true },
          preference: { shouldExtract: true },
        }),
      };

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      const allLayers = [
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Identity,
        LayersEnum.Preference,
      ];

      await (service as any).run(
        createMockJob(allLayers),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      // All layers should be executed in order
      expect(executionOrder).toEqual([
        LayersEnum.Activity,
        LayersEnum.Context,
        LayersEnum.Experience,
        LayersEnum.Preference,
        LayersEnum.Identity,
      ]);
    });

    it('should intersect gateKeeper decision with requested job layers', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      // GateKeeper allows all layers
      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: true },
          context: { shouldExtract: true },
          experience: { shouldExtract: true },
          identity: { shouldExtract: true },
          preference: { shouldExtract: true },
        }),
      };

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      // But job only requests activity and identity
      const requestedLayers = [LayersEnum.Activity, LayersEnum.Identity];

      await (service as any).run(
        createMockJob(requestedLayers),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      // Only requested layers should be executed
      expect(executionOrder).toEqual([LayersEnum.Activity, LayersEnum.Identity]);
    });

    it('should skip requested layers when gateKeeper returns shouldExtract=false', async () => {
      const service = new MemoryExtractionService(createMockOptions());
      const executionOrder: LayersEnum[] = [];

      // GateKeeper only allows context
      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: false },
          context: { shouldExtract: true },
          experience: { shouldExtract: false },
          identity: { shouldExtract: false },
          preference: { shouldExtract: false },
        }),
      };

      (service as any).runLayer = vi.fn().mockImplementation(
        (_job: any, layer: LayersEnum) => {
          executionOrder.push(layer);
          return Promise.resolve({ entries: [], summary: `mock ${layer}` });
        },
      );

      // Job requests activity, context, and identity
      const requestedLayers = [LayersEnum.Activity, LayersEnum.Context, LayersEnum.Identity];

      await (service as any).run(
        createMockJob(requestedLayers),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      // Only context should be executed (allowed by both gateKeeper and job)
      expect(executionOrder).toEqual([LayersEnum.Context]);
    });

    it('should not execute any layer when job layers are empty and gateKeeper returns all false', async () => {
      const service = new MemoryExtractionService(createMockOptions());

      (service as any).gatekeeper = {
        check: vi.fn().mockResolvedValue({
          activity: { shouldExtract: false },
          context: { shouldExtract: false },
          experience: { shouldExtract: false },
          identity: { shouldExtract: false },
          preference: { shouldExtract: false },
        }),
      };

      const runLayerSpy = vi.fn();
      (service as any).runLayer = runLayerSpy;

      // Job requests no specific layers (should use all from gateKeeper)
      const result = await (service as any).run(
        createMockJob([]),
        { retrievedContexts: '', retrievedIdentitiesContext: '' },
      );

      expect(runLayerSpy).not.toHaveBeenCalled();
      expect(result.layers).toEqual([]);
    });
  });
});
