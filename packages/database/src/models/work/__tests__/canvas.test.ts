// @vitest-environment node
import type { RegisterCanvasWorkParams } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agents, topics, workspaces } from '../../../schemas';
import { WorkModel } from '..';
import {
  agentId,
  agentId2,
  cleanupWorkTestData,
  seedWorkTestData,
  serverDB,
  threadId,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

const params = (overrides: Partial<RegisterCanvasWorkParams> = {}): RegisterCanvasWorkParams => ({
  agentId,
  canvasId: 'cvs_cost',
  description: 'Total cost up 23%',
  metadata: {
    entry: 'index.html',
    fileCount: 2,
    manifestKey: 'canvas/u/cvs_cost/manifests/a.json',
    runtimeMajor: 1,
    totalSize: 4096,
  },
  rootOperationId: 'op-canvas-1',
  threadId,
  title: 'October cost report',
  toolCallId: 'call-canvas-1',
  toolIdentifier: 'lobe-canvas',
  toolName: 'createCanvas',
  topicId,
  ...overrides,
});

describe('WorkModel · canvas', () => {
  describe('workspace visibility', () => {
    const workspaceId = 'canvas-visibility-workspace';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Canvas workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.update(agents).set({ workspaceId }).where(eq(agents.id, agentId));
      await serverDB.update(topics).set({ workspaceId }).where(eq(topics.id, topicId));
    });

    it.each(['public', 'private'] as const)(
      'inherits the creating agent’s %s visibility for teammate reads and galleries',
      async (visibility) => {
        await serverDB.update(agents).set({ visibility }).where(eq(agents.id, agentId));
        const owner = new WorkModel(serverDB, userId, workspaceId);
        const teammate = new WorkModel(serverDB, userId2, workspaceId);

        const work = await owner.registerCanvas(params());

        expect((await owner.findCanvas('cvs_cost'))?.work.id).toBe(work.id);
        expect((await teammate.findCanvas('cvs_cost'))?.work.id).toBe(
          visibility === 'public' ? work.id : undefined,
        );
        const gallery = await teammate.listByWorkspace({ includeFileWorks: true });
        expect(gallery.items.map((item) => item.id)).toEqual(
          visibility === 'public' ? [work.id] : [],
        );
        const summaries = await teammate.listSummariesByRootOperations({
          includeFileWorks: true,
          rootOperationIds: ['op-canvas-1'],
        });
        expect(summaries['op-canvas-1'].map((item) => item.id)).toEqual(
          visibility === 'public' ? [work.id] : [],
        );
      },
    );

    it.each(['public', 'private'] as const)(
      'keeps an existing %s canvas’s visibility when the agent changes',
      async (visibility) => {
        const owner = new WorkModel(serverDB, userId, workspaceId);
        const work = await owner.registerCanvas(params({ visibility }));
        await serverDB
          .update(agents)
          .set({ visibility: visibility === 'public' ? 'private' : 'public' })
          .where(eq(agents.id, agentId));

        await owner.registerCanvas(
          params({ toolCallId: 'call-canvas-update', toolName: 'updateCanvas' }),
        );

        const teammate = new WorkModel(serverDB, userId2, workspaceId);
        expect((await teammate.findCanvas('cvs_cost'))?.work.id).toBe(
          visibility === 'public' ? work.id : undefined,
        );
        expect((await owner.findCanvas('cvs_cost'))?.work.visibility).toBe(visibility);
      },
    );

    it('keeps an explicitly private canvas private under a public agent', async () => {
      const owner = new WorkModel(serverDB, userId, workspaceId);
      await owner.registerCanvas(params({ visibility: 'private' }));

      expect(await new WorkModel(serverDB, userId2, workspaceId).findCanvas('cvs_cost')).toBeNull();
    });

    it('does not inherit public visibility from an agent outside the workspace', async () => {
      const owner = new WorkModel(serverDB, userId, workspaceId);
      await owner.registerCanvas(params({ agentId: agentId2 }));

      expect(await new WorkModel(serverDB, userId2, workspaceId).findCanvas('cvs_cost')).toBeNull();
    });
  });

  it('appends a version per registration of the same canvas id', async () => {
    const model = new WorkModel(serverDB, userId);

    const first = await model.registerCanvas(params());
    const second = await model.registerCanvas(
      params({
        metadata: { ...params().metadata, manifestKey: 'canvas/u/cvs_cost/manifests/b.json' },
        title: 'October cost report v2',
        toolCallId: 'call-canvas-2',
        toolName: 'writeCanvasFiles',
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      resourceType: 'canvas',
      title: 'October cost report v2',
      type: 'canvas',
    });

    const versions = await model.listVersions(first.id);
    expect(versions.map((v) => [v.version, v.changeType])).toEqual([
      [2, 'updated'],
      [1, 'created'],
    ]);
    expect(versions[0].metadata?.canvas?.manifestKey).toBe('canvas/u/cvs_cost/manifests/b.json');
    expect(versions[1]).toMatchObject({ messageId: null, toolCallId: 'call-canvas-1' });
  });

  it('resolves a canvas with its current version, scoped to the owner', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerCanvas(params());

    const found = await model.findCanvas('cvs_cost');
    expect(found).toMatchObject({ version: { version: 1 }, work: { id: work.id } });
    expect(found?.version.metadata?.canvas?.entry).toBe('index.html');

    expect(await new WorkModel(serverDB, userId2).findCanvas('cvs_cost')).toBeNull();
    expect(await model.findCanvas('cvs_missing')).toBeNull();
  });

  it('reads a specific version of a canvas', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerCanvas(params());
    await model.registerCanvas(params({ toolCallId: 'call-canvas-2' }));

    expect((await model.findCanvasVersion(work.id, 1))?.version).toBe(1);
    expect((await model.findCanvasVersion(work.id, 2))?.version).toBe(2);
    expect(await model.findCanvasVersion(work.id, 3)).toBeNull();
  });

  it('lists canvases first made by an agent, newest first', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerCanvas(params());
    await model.registerCanvas(params({ canvasId: 'cvs_other', title: 'Other', toolCallId: 'c3' }));

    const list = await model.listCanvases({ agentId });
    expect(list.map((item) => item.resourceId)).toEqual(['cvs_other', 'cvs_cost']);
    expect(await model.listCanvases({ agentId: 'nobody' })).toEqual([]);
  });

  it('reports a deleted canvas work so its stored files can be purged', async () => {
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerCanvas(params());
    const secondManifest = 'canvas/u/cvs_cost/manifests/b.json';
    await model.registerCanvas(
      params({
        metadata: { ...params().metadata, manifestKey: secondManifest },
        toolCallId: 'call-canvas-delete-2',
      }),
    );

    const [removed] = await model.deleteWork({ id: work.id });
    expect(removed).toMatchObject({ resourceId: 'cvs_cost', resourceType: 'canvas' });
    expect(removed.canvasManifestKeys).toEqual(
      expect.arrayContaining([params().metadata.manifestKey, secondManifest]),
    );
    expect(removed.canvasManifestKeys).toHaveLength(2);
    expect(await model.findCanvas('cvs_cost')).toBeNull();
    expect(await model.listVersions(work.id)).toEqual([]);
  });

  it('records where a canvas is published, owner only, keeping other metadata', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerCanvas(params());

    expect(
      await new WorkModel(serverDB, userId2).recordCanvasPublish('cvs_cost', {
        deploymentId: 'dep_1',
        publishedVersion: 1,
        url: 'https://evil.lobehub.sites',
      }),
    ).toBeNull();
    const work = await model.recordCanvasPublish('cvs_cost', {
      deploymentId: 'dep_1',
      publishedVersion: 1,
      url: 'https://cost.lobehub.sites',
    });

    expect(work).toMatchObject({
      metadata: { canvasPublish: { deploymentId: 'dep_1', publishedVersion: 1 } },
      url: 'https://cost.lobehub.sites',
    });
    expect((await model.findCanvas('cvs_cost'))?.work.url).toBe('https://cost.lobehub.sites');
  });

  it('keeps the public link of a published canvas when a newer version is registered', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerCanvas(params());
    await model.recordCanvasPublish('cvs_cost', {
      deploymentId: 'dep_1',
      publishedVersion: 1,
      url: 'https://cost.lobehub.sites',
    });

    await model.registerCanvas(params({ toolCallId: 'call-canvas-2', toolName: 'updateCanvas' }));

    const current = await model.findCanvas('cvs_cost');
    expect(current?.version.version).toBe(2);
    expect(current?.work).toMatchObject({
      metadata: { canvasPublish: { deploymentId: 'dep_1', publishedVersion: 1 } },
      url: 'https://cost.lobehub.sites',
    });
  });

  it('only surfaces canvas works to clients that opted into newer work types', async () => {
    const model = new WorkModel(serverDB, userId);
    await model.registerCanvas(params());

    const optedIn = await model.listSummariesByRootOperations({
      includeFileWorks: true,
      rootOperationIds: ['op-canvas-1'],
    });
    expect(optedIn['op-canvas-1']).toHaveLength(1);
    expect(optedIn['op-canvas-1'][0]).toMatchObject({ type: 'canvas' });

    const legacy = await model.listSummariesByRootOperations({ rootOperationIds: ['op-canvas-1'] });
    expect(legacy['op-canvas-1'] ?? []).toEqual([]);
  });
});
