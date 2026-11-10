// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccounts, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentAccountModel } from '../agentAccount';
import { AgentMailModel } from '../agentMail';
import { AgentMailDraftModel } from '../agentMailDraft';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'draft-model-user';
const otherUserId = 'draft-model-other';
const agentId = 'draft-model-agent';

let accountId = '';
let model: AgentMailDraftModel;

const base = () => ({ accountId, agentId, mode: 'compose' as const });

beforeEach(async () => {
  await serverDB
    .insert(users)
    .values([{ id: userId }, { id: otherUserId }])
    .onConflictDoNothing();
  await serverDB.insert(agents).values({ id: agentId, userId }).onConflictDoNothing();
  const account = await new AgentAccountModel(serverDB, userId).create({
    agentId,
    capabilities: { receive: true, send: true },
    identifier: 'draft@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
  });
  accountId = account.id;
  model = new AgentMailDraftModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(agentAccounts).where(eq(agentAccounts.id, accountId));
  await serverDB.delete(agents).where(eq(agents.id, agentId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('AgentMailDraftModel', () => {
  it('creates, reads, updates, lists and deletes', async () => {
    const draft = (await model.create({ ...base(), subject: 'hi', text: 'one' }))!;
    expect((await model.findById(draft.id))?.text).toBe('one');

    await model.update(draft.id, { text: 'two', to: [{ address: 'a@x.io' }] });

    const [listed] = await model.list({ agentId });
    expect(listed).toMatchObject({ id: draft.id, text: 'two', to: [{ address: 'a@x.io' }] });
    expect(await model.count({ agentId })).toBe(1);

    expect(await model.delete([draft.id])).toBe(1);
    expect(await model.findById(draft.id)).toBeUndefined();
  });

  it('allows many new-mail drafts but one per mail and way of answering', async () => {
    const { mail } = await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        deliveredAt: new Date(),
        direction: 'inbound',
        fromAddress: 'a@x.io',
        provider: 'agent-mail',
        providerMessageId: 'draft_src',
        text: 'source',
      },
      { userId },
    );
    await model.create(base());
    await model.create(base());
    expect(await model.count({ agentId })).toBe(2);

    const reply = { ...base(), mode: 'reply' as const, sourceMailId: mail.id };
    const first = (await model.create({ ...reply, text: 'first' }))!;
    const again = (await model.create({ ...reply, text: 'second' }))!;
    const forward = (await model.create({ ...reply, mode: 'forward' }))!;

    expect(again.id).toBe(first.id);
    expect(again.text).toBe('second');
    expect(forward.id).not.toBe(first.id);
  });

  it('keeps what it was not asked to change when the same draft is resumed', async () => {
    const { mail } = await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        deliveredAt: new Date(),
        direction: 'inbound',
        fromAddress: 'a@x.io',
        provider: 'agent-mail',
        providerMessageId: 'draft_src_resume',
        text: 'source',
      },
      { userId },
    );
    const reply = { ...base(), mode: 'reply' as const, sourceMailId: mail.id };

    await model.create({
      ...reply,
      subject: 'Re: source',
      text: 'my answer',
      to: [{ address: 'a@x.io' }],
    });

    // Answering the same mail again without content resumes what is there.
    const resumed = (await model.create({ ...reply }))!;
    expect(resumed).toMatchObject({
      subject: 'Re: source',
      text: 'my answer',
      to: [{ address: 'a@x.io' }],
    });

    // Supplying a field still replaces it.
    const edited = (await model.create({ ...reply, text: 'better answer' }))!;
    expect(edited).toMatchObject({ subject: 'Re: source', text: 'better answer' });
    expect(edited.to).toEqual([{ address: 'a@x.io' }]);
  });

  it('lets one sender at a time claim a draft, and frees it on release', async () => {
    const draft = (await model.create(base()))!;

    expect(await model.claimForSend(draft.id)).toBeDefined();
    expect(await model.claimForSend(draft.id)).toBeUndefined();

    await model.releaseSend(draft.id);
    expect(await model.claimForSend(draft.id)).toBeDefined();
  });

  it('refuses edits while a send holds the draft, so none are lost', async () => {
    const draft = await model.create({ ...base(), text: 'sent version' });
    await model.claimForSend(draft.id);

    expect(await model.update(draft.id, { text: 'late edit' })).toBeUndefined();
    expect((await model.findById(draft.id))?.text).toBe('sent version');

    await model.releaseSend(draft.id);
    expect((await model.update(draft.id, { text: 'late edit' }))?.text).toBe('late edit');
  });

  it('refuses a resumed reply while that draft is being sent', async () => {
    const { mail } = await AgentMailModel.record(
      serverDB,
      {
        accountId,
        agentId,
        deliveredAt: new Date(),
        direction: 'inbound',
        fromAddress: 'a@x.io',
        provider: 'agent-mail',
        providerMessageId: 'draft_src_lease',
        text: 'source',
      },
      { userId },
    );
    const reply = { ...base(), mode: 'reply' as const, sourceMailId: mail.id };
    const draft = (await model.create({ ...reply, text: 'sent version' }))!;
    await model.claimForSend(draft.id);

    expect(await model.create({ ...reply, text: 'late edit' })).toBeUndefined();
    expect((await model.findById(draft.id))?.text).toBe('sent version');
  });

  it('hides drafts from anyone outside the scope', async () => {
    const draft = (await model.create(base()))!;
    const stranger = new AgentMailDraftModel(serverDB, otherUserId);

    expect(await stranger.findById(draft.id)).toBeUndefined();
    expect(await stranger.list({ agentId })).toEqual([]);
    expect(await stranger.update(draft.id, { text: 'x' })).toBeUndefined();
    expect(await stranger.delete([draft.id])).toBe(0);
    expect(await stranger.claimForSend(draft.id)).toBeUndefined();
  });
});
