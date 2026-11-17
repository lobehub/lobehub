import { describe, expect, it } from 'vitest';

import { WebhookManifest } from './manifest';
import { WebhookApiName, WebhookIdentifier } from './types';

const api = (name: string) => WebhookManifest.api.find((entry) => entry.name === name)!;

describe('webhook tool manifest', () => {
  it('declares every API once, under the stable identifier', () => {
    expect(WebhookManifest.identifier).toBe('lobe-webhook');
    expect(WebhookIdentifier).toBe('lobe-webhook');
    expect(WebhookManifest.api.map((entry) => entry.name).sort()).toEqual(
      Object.values(WebhookApiName).sort(),
    );
  });

  it('asks for approval before changing anything, never for reads', () => {
    // Reads are named list*; everything else changes a webhook or runs its agent.
    for (const entry of WebhookManifest.api)
      expect(entry.humanIntervention, entry.name).toBe(
        entry.name.startsWith('list') ? 'never' : 'required',
      );
  });

  it('never takes an agent, a key or an arbitrary Channel from the model', () => {
    for (const entry of WebhookManifest.api) {
      const properties = Object.keys(entry.parameters.properties ?? {});
      for (const forbidden of [
        'agentId',
        'secret',
        'key',
        'token',
        'channelId',
        'threadId',
        'topicId',
      ])
        expect(properties).not.toContain(forbidden);
    }
    expect(api(WebhookApiName.createWebhook).parameters.properties.deliverTo.enum).toEqual([
      'topic',
      'channel',
      'thread',
    ]);
  });

  it('explains every public parameter', () => {
    for (const entry of WebhookManifest.api)
      for (const parameter of Object.values<{ description?: string }>(
        entry.parameters.properties ?? {},
      ))
        expect(parameter.description?.length).toBeGreaterThan(20);
    expect(api(WebhookApiName.updateWebhook).parameters.required).toEqual(['webhookId']);
  });

  it('tells the model keys are issued by the user, never pasted into the chat', () => {
    expect(WebhookManifest.systemRole).toContain('never see');
    expect(WebhookManifest.systemRole).toContain('never ask the user to paste');
    expect(WebhookManifest.systemRole).toContain('lh webhook rotate-key');
  });

  it('points the model to the MCP Events tool for subscriptions', () => {
    expect(WebhookManifest.systemRole).toContain('MCP Events tool');
  });

  it('tells the model the name is for people and the identifier is fixed', () => {
    expect(WebhookManifest.systemRole).toContain('identifier is fixed');
    expect(WebhookManifest.systemRole).toContain('<webhookEvent identifier=');
    expect(api(WebhookApiName.createWebhook).parameters.properties.name.description).toContain(
      'identifier',
    );
  });
});
