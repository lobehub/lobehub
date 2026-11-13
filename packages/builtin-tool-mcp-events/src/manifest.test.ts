import { describe, expect, it } from 'vitest';

import { McpEventsManifest } from './manifest';
import { McpEventsApiName } from './types';

describe('MCP Events approval policy', () => {
  it('always requires approval before creating a recurring agent trigger', () => {
    expect(
      McpEventsManifest.api.find((api) => api.name === McpEventsApiName.subscribeEvent)
        ?.humanIntervention,
    ).toBe('always');
    expect(
      McpEventsManifest.api
        .filter((api) => api.name !== McpEventsApiName.subscribeEvent)
        .every((api) => api.humanIntervention === 'never'),
    ).toBe(true);
  });

  it('requires the handling instructions and scopes the public schema to connector identifiers', () => {
    const subscribe = McpEventsManifest.api.find(
      (api) => api.name === McpEventsApiName.subscribeEvent,
    )!;
    expect(subscribe.parameters.required).toEqual(['connector', 'name', 'instructions']);
    expect(subscribe.parameters.properties).not.toHaveProperty('topicId');
    expect(subscribe.parameters.properties).not.toHaveProperty('agentId');
  });
  it('explains every public parameter and the source of identifiers for later autonomous runs', () => {
    for (const api of McpEventsManifest.api) {
      for (const parameter of Object.values(api.parameters.properties ?? {})) {
        expect(parameter.description?.length).toBeGreaterThan(20);
      }
    }
    const subscribe = McpEventsManifest.api.find(
      (api) => api.name === McpEventsApiName.subscribeEvent,
    )!;
    expect(subscribe.parameters.properties?.connector.description).toContain(
      'connector.identifier',
    );
    expect(subscribe.parameters.properties?.name.description).toContain('listEventTypes');
    expect(subscribe.parameters.properties?.arguments.description).toContain('inputSchema');
    expect(subscribe.parameters.properties?.instructions.description).toContain(
      'independently executable',
    );
    expect(subscribe.parameters.properties?.instructions.description).toContain('user is absent');
    const remove = McpEventsManifest.api.find(
      (api) => api.name === McpEventsApiName.unsubscribeEvent,
    )!;
    expect(remove.parameters.properties?.subscriptionId.description).toContain('subscription.id');
  });
});
