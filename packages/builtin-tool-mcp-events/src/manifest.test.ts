import { describe, expect, it } from 'vitest';

import { McpEventsManifest } from './manifest';
import { McpEventsApiName, McpEventsIdentifier } from './types';

const api = (name: string) => McpEventsManifest.api.find((entry) => entry.name === name)!;

describe('MCP Events manifest', () => {
  it('declares every API once, under the stable identifier', () => {
    expect(McpEventsManifest.identifier).toBe(McpEventsIdentifier);
    expect(McpEventsManifest.api.map((entry) => entry.name).sort()).toEqual(
      Object.values(McpEventsApiName).sort(),
    );
  });

  it('asks before subscribing only; reads, renames, checks and removals run without asking', () => {
    expect(
      Object.fromEntries(
        McpEventsManifest.api.map((entry) => [entry.name, entry.humanIntervention]),
      ),
    ).toEqual({
      checkSubscription: 'never',
      listEventTypes: 'never',
      listSubscriptions: 'never',
      renameSubscription: 'never',
      subscribeEvent: 'required',
      unsubscribeEvent: 'required',
    });
  });

  it('lists this topic by default, or the whole agent on request', () => {
    const list = api(McpEventsApiName.listSubscriptions);
    expect(list.parameters.properties?.scope.enum).toEqual(['topic', 'agent']);
    expect(list.parameters.required).toBeUndefined();
  });

  it('never takes an agent, a topic or a user from the model', () => {
    for (const entry of McpEventsManifest.api)
      for (const forbidden of ['agentId', 'topicId', 'userId'])
        expect(Object.keys(entry.parameters.properties ?? {})).not.toContain(forbidden);
  });

  it('tells the model the name is for people and the event is fixed', () => {
    expect(McpEventsManifest.systemRole).toContain('<mcpEvent event=');
    expect(McpEventsManifest.systemRole).toContain('Webhooks tool');
    expect(api(McpEventsApiName.renameSubscription).parameters.required).toEqual([
      'subscriptionId',
      'name',
    ]);
    expect(api(McpEventsApiName.renameSubscription).description).toContain('eventName');
  });
});

describe('MCP Events approval policy', () => {
  it('asks for approval before subscribing or ending one, unless the user lets tools run', () => {
    const asks = new Set<string>([
      McpEventsApiName.subscribeEvent,
      McpEventsApiName.unsubscribeEvent,
    ]);
    for (const api of McpEventsManifest.api)
      expect(api.humanIntervention).toBe(asks.has(api.name) ? 'required' : 'never');
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
    for (const name of [
      McpEventsApiName.unsubscribeEvent,
      McpEventsApiName.renameSubscription,
      McpEventsApiName.checkSubscription,
    ])
      expect(api(name).parameters.properties?.subscriptionId.description).toContain(
        'subscription.id',
      );
  });
});
