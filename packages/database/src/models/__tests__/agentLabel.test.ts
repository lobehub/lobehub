// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentLabelAssignments, agentLabels, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentLabelModel } from '../agentLabel';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-label-test-user';
const otherUserId = 'agent-label-test-user-2';
const workspaceId = 'agent-label-test-ws';

const personalModel = new AgentLabelModel(serverDB, userId);
const workspaceModel = new AgentLabelModel(serverDB, userId, workspaceId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values([
      { id: workspaceId, name: 'Test WS', primaryOwnerId: userId, slug: 'agent-label-test-ws' },
    ]);
});

afterEach(async () => {
  await serverDB.delete(agentLabels);
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

const createAgent = async (id: string, wsId?: string) => {
  await serverDB.insert(agents).values({ id, userId, workspaceId: wsId ?? null });
};

describe('AgentLabelModel', () => {
  describe('create / query', () => {
    it('should create a personal label with workspace_id NULL', async () => {
      const label = await personalModel.create({ color: '#ff0000', name: 'Bug' });

      expect(label.id).toBeDefined();
      expect(label).toMatchObject({ color: '#ff0000', name: 'Bug', userId, workspaceId: null });
    });

    it('should create a workspace label shared across members', async () => {
      const label = await workspaceModel.create({ name: 'Team Label' });
      expect(label.workspaceId).toBe(workspaceId);

      // another member of the same workspace sees it
      const memberModel = new AgentLabelModel(serverDB, otherUserId, workspaceId);
      const labels = await memberModel.query();
      expect(labels).toHaveLength(1);
      expect(labels[0].name).toBe('Team Label');
    });

    it('should isolate personal labels from workspace labels', async () => {
      await personalModel.create({ name: 'Personal' });
      await workspaceModel.create({ name: 'Workspace' });

      const personal = await personalModel.query();
      const workspace = await workspaceModel.query();

      expect(personal.map((l) => l.name)).toEqual(['Personal']);
      expect(workspace.map((l) => l.name)).toEqual(['Workspace']);
    });

    it('should not leak personal labels between users', async () => {
      await personalModel.create({ name: 'Mine' });

      const otherModel = new AgentLabelModel(serverDB, otherUserId);
      expect(await otherModel.query()).toHaveLength(0);
    });

    it('should include usage count', async () => {
      await createAgent('agt-usage');
      const label = await personalModel.create({ name: 'Used' });
      await personalModel.setAgentLabels('agt-usage', [label.id]);

      const labels = await personalModel.query();
      expect(labels[0].usageCount).toBe(1);
    });
  });

  describe('update / archive', () => {
    it('should update name and color', async () => {
      const label = await workspaceModel.create({ name: 'Old' });
      await workspaceModel.update(label.id, { color: '#00ff00', name: 'New' });

      const updated = await workspaceModel.findById(label.id);
      expect(updated).toMatchObject({ color: '#00ff00', name: 'New' });
    });

    it('should archive and unarchive', async () => {
      const label = await workspaceModel.create({ name: 'Archivable' });
      await workspaceModel.update(label.id, { archived: true });
      expect((await workspaceModel.findById(label.id))?.archived).toBe(true);

      await workspaceModel.update(label.id, { archived: false });
      expect((await workspaceModel.findById(label.id))?.archived).toBe(false);
    });

    it('should not update labels outside the scope', async () => {
      const label = await personalModel.create({ name: 'Personal' });
      await workspaceModel.update(label.id, { name: 'Hacked' });

      expect((await personalModel.findById(label.id))?.name).toBe('Personal');
    });
  });

  describe('delete', () => {
    it('should delete label and cascade assignments', async () => {
      await createAgent('agt-del');
      const label = await personalModel.create({ name: 'Doomed' });
      await personalModel.setAgentLabels('agt-del', [label.id]);

      await personalModel.delete(label.id);

      expect(await personalModel.findById(label.id)).toBeUndefined();
      const assignments = await serverDB
        .select()
        .from(agentLabelAssignments)
        .where(eq(agentLabelAssignments.agentId, 'agt-del'));
      expect(assignments).toHaveLength(0);
    });
  });

  describe('setAgentLabels', () => {
    it('should replace the label set of an agent', async () => {
      await createAgent('agt-set');
      const a = await personalModel.create({ name: 'A' });
      const b = await personalModel.create({ name: 'B' });
      const c = await personalModel.create({ name: 'C' });

      await personalModel.setAgentLabels('agt-set', [a.id, b.id]);
      expect((await personalModel.getAgentLabelIds('agt-set')).toSorted()).toEqual(
        [a.id, b.id].toSorted(),
      );

      await personalModel.setAgentLabels('agt-set', [b.id, c.id]);
      expect((await personalModel.getAgentLabelIds('agt-set')).toSorted()).toEqual(
        [b.id, c.id].toSorted(),
      );

      await personalModel.setAgentLabels('agt-set', []);
      expect(await personalModel.getAgentLabelIds('agt-set')).toEqual([]);
    });

    it('should reject agents outside the scope', async () => {
      await createAgent('agt-scope');
      const label = await workspaceModel.create({ name: 'WS' });

      await expect(workspaceModel.setAgentLabels('agt-scope', [label.id])).rejects.toThrow();
    });

    it('should reject labels outside the scope instead of dropping them', async () => {
      await createAgent('agt-cross');
      const wsLabel = await workspaceModel.create({ name: 'WS Only' });

      await expect(personalModel.setAgentLabels('agt-cross', [wsLabel.id])).rejects.toThrow(
        /not found in current scope/,
      );
    });

    it('should not wipe existing labels when the caller sends a foreign id', async () => {
      // Regression: this is a full replacement, so silently dropping an
      // unresolvable id shrinks the next set and deletes assignments the
      // caller never touched. A client still holding another workspace's
      // registry across a scope switch would erase the agent's labels.
      await createAgent('agt-stale');
      const mine = await personalModel.create({ name: 'Mine' });
      const foreign = await workspaceModel.create({ name: 'Theirs' });

      await personalModel.setAgentLabels('agt-stale', [mine.id]);

      await expect(
        personalModel.setAgentLabels('agt-stale', [mine.id, foreign.id]),
      ).rejects.toThrow();

      expect(await personalModel.getAgentLabelIds('agt-stale')).toEqual([mine.id]);
    });

    it('should not clobber a concurrent editor when toggling one label', async () => {
      // Regression: the menu used to send a full replacement built from its
      // cached assignment set, so a click made against a stale list deleted
      // whatever another editor had added since that list was fetched.
      await createAgent('agt-race');
      const a = await personalModel.create({ name: 'A' });
      const b = await personalModel.create({ name: 'B' });

      // Another editor applies A.
      await personalModel.toggleAgentLabel('agt-race', a.id, true);

      // This client's cache still says "no labels"; it toggles B on.
      await personalModel.toggleAgentLabel('agt-race', b.id, true);

      expect((await personalModel.getAgentLabelIds('agt-race')).toSorted()).toEqual(
        [a.id, b.id].toSorted(),
      );
    });

    it('should be idempotent when toggling the same label on twice', async () => {
      await createAgent('agt-idem');
      const label = await personalModel.create({ name: 'Idem' });

      await personalModel.toggleAgentLabel('agt-idem', label.id, true);
      await personalModel.toggleAgentLabel('agt-idem', label.id, true);

      expect(await personalModel.getAgentLabelIds('agt-idem')).toEqual([label.id]);
    });

    it('should refuse to newly apply an archived label through the toggle', async () => {
      await createAgent('agt-toggle-arch');
      const label = await personalModel.create({ name: 'Retired' });
      await personalModel.update(label.id, { archived: true });

      await expect(
        personalModel.toggleAgentLabel('agt-toggle-arch', label.id, true),
      ).rejects.toThrow(/archived/);
    });

    it('should not newly apply archived labels but keep existing ones', async () => {
      await createAgent('agt-arch');
      const active = await personalModel.create({ name: 'Active' });
      const archived = await personalModel.create({ name: 'Archived' });

      await personalModel.setAgentLabels('agt-arch', [archived.id]);
      await personalModel.update(archived.id, { archived: true });

      // keeping an already-assigned archived label is allowed
      const kept = await personalModel.setAgentLabels('agt-arch', [archived.id, active.id]);
      expect(kept.toSorted()).toEqual([active.id, archived.id].toSorted());

      // newly applying an archived label is filtered out
      await personalModel.setAgentLabels('agt-arch', []);
      const next = await personalModel.setAgentLabels('agt-arch', [archived.id]);
      expect(next).toEqual([]);
    });
  });
});
