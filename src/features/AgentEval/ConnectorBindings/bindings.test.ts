import type { AgentEvalDatasetPackageConnectionRequirement } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { hasPartialConnectorBindings, setConnectorBinding } from './bindings';

const environment: AgentEvalDatasetPackageConnectionRequirement = {
  key: 'shared-key',
  name: 'Mail and calendar',
  scope: 'environment',
  services: ['gmail', 'calendar'],
};
const testcase: AgentEvalDatasetPackageConnectionRequirement = { ...environment, scope: 'case' };
const connection = { connectorId: 'connection-a', transport: 'mcp' as const };

describe('dataset connector selection', () => {
  it('leaves automatic or deferred package bindings untouched until the user selects a connection', () => {
    expect(hasPartialConnectorBindings([environment], {})).toBe(false);
    const partial = setConnectorBinding({}, environment, 'gmail', connection);
    expect(hasPartialConnectorBindings([environment], partial)).toBe(true);
    const complete = setConnectorBinding(partial, environment, 'calendar', connection);
    expect(hasPartialConnectorBindings([environment], complete)).toBe(false);
  });

  it('isolates case and environment scopes even when their portable keys are identical', () => {
    const original = {
      environmentBindings: { 'shared-key': { gmail: connection, calendar: connection } },
    };
    const changed = setConnectorBinding(original, testcase, 'gmail', {
      connectorId: 'connection-b',
    });
    expect(changed.environmentBindings).toEqual(original.environmentBindings);
    expect(changed.caseBindings?.['shared-key'].gmail.connectorId).toBe('connection-b');
    expect(original).not.toHaveProperty('caseBindings');
  });

  it('clearing the last selection restores omitted import scope instead of sending an incomplete replacement', () => {
    const selected = setConnectorBinding({}, environment, 'gmail', connection);
    const cleared = setConnectorBinding(selected, environment, 'gmail');
    expect(cleared.environmentBindings).not.toHaveProperty('shared-key');
    expect(hasPartialConnectorBindings([environment], cleared)).toBe(false);
    expect(
      hasPartialConnectorBindings([environment], { environmentBindings: { 'shared-key': {} } }),
    ).toBe(true);
  });
});
