// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { validateDatasetPackage } from './datasetPackageSchema';

const example = () => ({
  cases: [{ content: { expected: 'hello', input: 'Reply with hello.' }, key: 'greeting' }],
  dataset: { evalMode: 'equals', name: 'Synthetic examples' },
  format: 'lobehub-eval-dataset',
  version: 1,
});

describe('dataset package schema', () => {
  it('rejects ungradable cases instead of depending on an absent system benchmark', () => {
    expect(() =>
      validateDatasetPackage({ ...example(), dataset: { name: 'Missing grading' } }),
    ).toThrow('grading mode');
  });
  it('preserves structured history, grading and shared environment references', () => {
    const pack = validateDatasetPackage({
      ...example(),
      cases: [
        {
          content: {
            input: 'Remember the greeting.',
            messages: [{ content: 'hello', role: 'user' }],
          },
          environmentKey: 'isolated',
          evalConfig: { judgePrompt: 'The answer must contain the greeting.' },
          evalMode: 'rule-checklist',
          key: 'memory',
          sortOrder: 4,
        },
      ],
      environments: [
        {
          config: { memory: {}, sessionDate: '2026-01-01T00:00:00Z' },
          key: 'isolated',
          name: 'Empty memory',
        },
      ],
    });
    expect(pack.cases[0]).toMatchObject({
      content: { messages: [{ content: 'hello', role: 'user' }] },
      environmentKey: 'isolated',
      evalConfig: { judgePrompt: 'The answer must contain the greeting.' },
      evalMode: 'rule-checklist',
      sortOrder: 4,
    });
    expect(pack.environments[0].config.memory).toEqual({});
  });

  it('rejects unknown versions, ownership, system flags and nonportable row IDs', () => {
    for (const pack of [
      { ...example(), version: 2 },
      { ...example(), userId: 'somebody-else' },
      { ...example(), dataset: { name: 'System', metadata: { kind: 'lobe-bench' } } },
      { ...example(), cases: [{ ...example().cases[0], environmentId: 'database-row' }] },
    ])
      expect(() => validateDatasetPackage(pack)).toThrow('Invalid dataset package');
  });

  it('rejects missing references and duplicate portable keys', () => {
    expect(() =>
      validateDatasetPackage({
        ...example(),
        cases: [{ ...example().cases[0], environmentKey: 'missing' }],
      }),
    ).toThrow('referenced environment');
    expect(() =>
      validateDatasetPackage({ ...example(), cases: [...example().cases, ...example().cases] }),
    ).toThrow('Case keys must be unique');
    expect(() =>
      validateDatasetPackage({
        ...example(),
        environments: [
          { config: {}, key: 'same', name: 'One' },
          { config: {}, key: 'same', name: 'Two' },
        ],
      }),
    ).toThrow('Environment keys must be unique');
  });

  it('accepts mock routing segments while rejecting package-supplied endpoints and credentials', () => {
    const mockPack = {
      ...example(),
      dataset: { ...example().dataset, metadata: { mock: { dataset: 'synthetic-v1' } } },
      environments: [
        { config: { mock: { services: ['example'] } }, key: 'mock', name: 'Synthetic mock' },
      ],
    };
    expect(validateDatasetPackage(mockPack).dataset.metadata?.mock?.dataset).toBe('synthetic-v1');
    expect(validateDatasetPackage({ ...mockPack, dataset: example().dataset })).toMatchObject({
      environments: mockPack.environments,
    });
    expect(() =>
      validateDatasetPackage({
        ...mockPack,
        dataset: {
          ...mockPack.dataset,
          metadata: { mock: { baseUrl: 'https://untrusted.example', dataset: 'synthetic-v1' } },
        },
      }),
    ).toThrow('Invalid dataset package');
    expect(() =>
      validateDatasetPackage({
        ...mockPack,
        environments: [
          {
            config: {
              toolForwarding: {
                example: { endpoint: 'https://untrusted.example', token: 'not-a-real-token' },
              },
            },
            key: 'mock',
            name: 'Mock',
          },
        ],
      }),
    ).toThrow('Invalid dataset package');
  });

  it('rejects installation-specific connections in shared and inline package environments', () => {
    const connectorBindings = {
      example: { connectorId: 'b34a8f4d-349a-41a9-b307-3a8754e8e5a8' },
    };
    for (const value of [
      {
        ...example(),
        environments: [{ config: { connectorBindings }, key: 'local', name: 'Local connection' }],
      },
      {
        ...example(),
        cases: [
          { key: 'inline', content: { input: 'Do work', environment: { connectorBindings } } },
        ],
      },
    ])
      expect(() => validateDatasetPackage(value)).toThrow('Invalid dataset package');
  });
  it('accepts private portable connection definitions and rejects invalid references safely', () => {
    const privatePack = {
      ...example(),
      connections: {
        privateMock: {
          credentials: { token: 'synthetic-private-token', type: 'bearer' },
          name: 'Private mock',
          url: 'https://mock.example/mcp',
        },
      },
      environments: [
        {
          connectionBindings: { notion: { connectionKey: 'privateMock' } },
          config: {},
          key: 'private',
          name: 'Private',
        },
      ],
    };
    expect(validateDatasetPackage(privatePack).connections?.privateMock.credentials).toMatchObject({
      type: 'bearer',
    });
    expect(() => validateDatasetPackage({ ...privatePack, connections: {} })).toThrow(
      'connection configuration',
    );
    for (const url of [
      'invalid-url-synthetic-private-token',
      'file:///private',
      'https://token@mock.example',
      'https://mock.example?token=synthetic-private-token',
    ]) {
      let message = '';
      try {
        validateDatasetPackage({
          ...privatePack,
          connections: { privateMock: { ...privatePack.connections.privateMock, url } },
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('connection configuration');
      expect(message).not.toContain('synthetic-private-token');
      expect(message).not.toContain(url);
    }
  });

  it('refuses a case that binds its own mock connection', () => {
    const pack = example();
    const withCaseBinding = {
      ...pack,
      cases: pack.cases.map((testCase, index) =>
        index === 0
          ? { ...testCase, connectionBindings: { notion: { connectionKey: 'privateMock' } } }
          : testCase,
      ),
      connections: { privateMock: { name: 'Private mock', url: 'https://mock.example/mcp' } },
    };
    expect(() => validateDatasetPackage(withCaseBinding)).toThrow('belong to an Environment');
  });
});
