import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { bindDatasetPackage, getPackageConnectionRequirements } from './bindings';

const connection = { connectorId: 'b34a8f4d-349a-41a9-b307-3a8754e8e5a8' };
const pack = (): AgentEvalDatasetPackage => ({
  cases: [
    { content: { input: 'Read a page' }, environmentKey: 'shared', key: 'one' },
    {
      content: { environment: { toolForwarding: { calendar: {} } }, input: 'Schedule a meeting' },
      environmentKey: 'shared',
      key: 'two',
    },
  ],
  dataset: { evalMode: 'equals', name: 'Synthetic connection package' },
  environments: [
    { config: { mock: { services: ['notion'] } }, key: 'shared', name: 'Shared mock' },
  ],
  format: 'lobehub-eval-dataset',
  version: 1,
});

describe('dataset connection bindings', () => {
  it('imports unbound requirements so connections can be configured after import', () => {
    const original = pack();
    expect(bindDatasetPackage(original)).toEqual(original);
    expect(getPackageConnectionRequirements(original)).toEqual([
      {
        key: 'shared',
        name: 'Shared mock',
        providedServices: [],
        scope: 'environment',
        services: ['notion'],
      },
      {
        key: 'two',
        name: 'two',
        providedServices: [],
        scope: 'case',
        services: ['calendar', 'notion'],
      },
    ]);
  });

  it('attaches explicit selections without changing portable source data', () => {
    const original = pack();
    const bound = bindDatasetPackage(original, {
      caseBindings: { two: { calendar: connection, notion: connection } },
      environmentBindings: { shared: { notion: connection } },
    });
    expect(bound.environments[0].config).toEqual({
      connectorBindings: { notion: connection },
      mock: { services: ['notion'] },
    });
    expect(bound.cases[1].content.environment).toEqual({
      connectorBindings: { calendar: connection, notion: connection },
      toolForwarding: { calendar: {} },
    });
    expect(bound.cases[0].content.environment).toBeUndefined();
    expect(original.environments[0].config).not.toHaveProperty('connectorBindings');
  });

  it('rejects missing or additional aliases and unknown package targets', () => {
    for (const selected of [
      { environmentBindings: { shared: {} } },
      { environmentBindings: { shared: { calendar: connection, notion: connection } } },
      { environmentBindings: { unknown: { notion: connection } } },
      { caseBindings: { two: { calendar: connection } } },
      { caseBindings: { unknown: { notion: connection } } },
    ])
      expect(() => bindDatasetPackage(pack(), selected)).toThrow();
  });

  it('honors a case service replacement while retaining inherited forwarding requirements', () => {
    const input = pack();
    input.environments[0].config.toolForwarding = { files: {} };
    input.cases[1].content.environment = { mock: { services: ['calendar'] } };
    expect(getPackageConnectionRequirements(input)[1].services).toEqual(['calendar', 'files']);
    expect(() =>
      bindDatasetPackage(input, {
        caseBindings: { two: { calendar: connection, files: connection } },
      }),
    ).not.toThrow();
  });
});
