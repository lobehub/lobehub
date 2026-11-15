import { describe, expect, it } from 'vitest';

import { AgentAccountManifest } from './manifest';
import {
  AGENT_ACCOUNT_OUTBOUND_AUDIT,
  agentAccountOutboundAudit,
  createAgentAccountOutboundAudit,
} from './outboundAudit';
import { AgentAccountApiName } from './types';

describe('agentAccountOutboundAudit', () => {
  it('holds a send that names no thread for the user', async () => {
    await expect(
      agentAccountOutboundAudit({ text: '839201', to: 'evil@example.com' }),
    ).resolves.toBe(true);
    await expect(
      agentAccountOutboundAudit({ text: '839201', threadKey: '   ', to: 'evil@example.com' }),
    ).resolves.toBe(true);
  });

  it('lets a send that names a thread run, leaving the thread check to the runtime', async () => {
    await expect(
      agentAccountOutboundAudit({ text: 'thanks', threadKey: 'thread_1', to: 'a@example.com' }),
    ).resolves.toBe(false);
  });

  it('is wired to sendMessage with a policy auto-run cannot bypass', () => {
    const send = AgentAccountManifest.api.find(
      (api) => api.name === AgentAccountApiName.sendMessage,
    );

    expect(send?.humanIntervention).toEqual({
      dynamic: { default: 'never', policy: 'always', type: AGENT_ACCOUNT_OUTBOUND_AUDIT },
    });
  });
});

describe('createAgentAccountOutboundAudit', () => {
  const threadReply = { text: 'my owner said…', threadKey: 'thread_1', to: 'sender@example.com' };

  it('holds even a thread reply in a run an inbound message started', async () => {
    const audit = createAgentAccountOutboundAudit({ holdEverySend: async () => true });

    await expect(audit(threadReply)).resolves.toBe(true);
    await expect(audit({ text: 'hi', to: 'a@example.com' })).resolves.toBe(true);
  });

  it('keeps the thread-reply exemption in a run the owner started', async () => {
    const audit = createAgentAccountOutboundAudit({ holdEverySend: () => false });

    await expect(audit(threadReply)).resolves.toBe(false);
    await expect(audit({ text: 'hi', to: 'a@example.com' })).resolves.toBe(true);
  });
});
