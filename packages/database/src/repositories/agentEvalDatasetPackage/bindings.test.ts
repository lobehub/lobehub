import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { bindDatasetPackage, getPackageConnectionRequirements } from './bindings';

const connection = { connectorId: 'b34a8f4d-349a-41a9-b307-3a8754e8e5a8' };
const pack = (): AgentEvalDatasetPackage => ({
  cases: [
    { content: { input: 'Read a page' }, environmentKey: 'shared', key: 'one' },
    {
      content: { environment: { mock: { services: ['notion'] } }, input: 'Schedule a meeting' },
      environmentKey: 'shared',
      key: 'two',
    },
  ],
  dataset: { evalMode: 'equals', name: 'Synthetic connection package' },
  environments: [
    { config: { mock: { services: ['notion', 'calendar'] } }, key: 'shared', name: 'Shared mock' },
  ],
  format: 'lobehub-eval-dataset',
  version: 1,
});

describe('dataset connection bindings', () => {
  it('imports unbound Environment requirements so connections can be configured after import', () => {
    const original = pack();
    expect(bindDatasetPackage(original)).toEqual(original);
    expect(getPackageConnectionRequirements(original)).toEqual([
      {
        key: 'shared',
        name: 'Shared mock',
        providedServices: [],
        scope: 'environment',
        services: ['calendar', 'notion'],
      },
    ]);
  });

  it('attaches an Environment selection and leaves the cases’ own settings unchanged', () => {
    const original = pack();
    const bound = bindDatasetPackage(original, {
      environmentBindings: { shared: { calendar: connection, notion: connection } },
    });
    expect(bound.environments[0].config).toEqual({
      connectorBindings: { calendar: connection, notion: connection },
      mock: { services: ['notion', 'calendar'] },
    });
    expect(bound.cases).toEqual(original.cases);
    expect(original.environments[0].config).not.toHaveProperty('connectorBindings');
  });

  it('stores package connections in the Environment that uses them', () => {
    const input = pack();
    input.connections = { mock: { name: 'Mock', url: 'https://mock.test/mcp/a/notion' } };
    input.environments[0].connectionBindings = {
      notion: { connectionKey: 'mock', transport: 'lobe-bench' },
    };
    const stored = { credentials: 'sealed', name: 'Mock', url: 'https://mock.test/mcp/a/notion' };
    const bound = bindDatasetPackage(input, undefined, {
      connections: new Map([['mock', stored]]),
      environmentIds: new Map([['shared', 'envShared']]),
    });
    expect(bound.environments[0].config.connections).toEqual({ notion: stored });
    expect(bound.environments[0].config.connectorBindings).toEqual({
      notion: { connectorId: 'env:envShared:notion', transport: 'lobe-bench' },
    });
  });

  it('rejects missing or additional aliases, unknown Environments and any case selection', () => {
    for (const selected of [
      { environmentBindings: { shared: { notion: connection } } },
      {
        environmentBindings: {
          shared: { calendar: connection, files: connection, notion: connection },
        },
      },
      { environmentBindings: { unknown: { notion: connection } } },
      { caseBindings: { two: { notion: connection } } },
    ])
      expect(() => bindDatasetPackage(pack(), selected)).toThrow();
  });

  it('refuses a case that binds its own connection or uses a service its Environment lacks', () => {
    const ownBinding = pack();
    ownBinding.connections = { mock: { name: 'Mock', url: 'https://mock.test/mcp/a/notion' } };
    ownBinding.cases[1].connectionBindings = { notion: { connectionKey: 'mock' } };
    expect(() => bindDatasetPackage(ownBinding)).toThrow('belong to an Environment');

    const extraService = pack();
    extraService.cases[1].content.environment = { toolForwarding: { files: {} } };
    expect(() => bindDatasetPackage(extraService)).toThrow('its Environment provides');
  });
});
