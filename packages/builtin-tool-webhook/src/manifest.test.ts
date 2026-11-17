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
    const approval = Object.fromEntries(
      WebhookManifest.api.map((entry) => [entry.name, entry.humanIntervention]),
    );
    expect(approval).toEqual({
      checkWebhook: 'never',
      createWebhook: 'required',
      deleteWebhook: 'required',
      listWebhookCalls: 'never',
      listWebhooks: 'never',
      sendTestWebhook: 'required',
      updateWebhook: 'required',
    });
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
});
