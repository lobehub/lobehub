// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { globalFiles, users, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { GitHub } from '@/server/modules/GitHub';

import { SkillImporter } from './importer';

vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: () => ({ uploadBuffer: vi.fn().mockResolvedValue({ key: 'test' }) }),
}));

const repo = 'https://github.com/owner/collection';
const commit = 'a'.repeat(40);
const review = 'skills/team/review';
const other = 'skills/other/review';
const doc = (name: string) =>
  strToU8(`---\nname: ${name}\ndescription: Tests\n---\nReview changes`);
const zip = Buffer.from(
  zipSync({
    ['repo-sha/' + review + '/SKILL.md']: doc('review'),
    ['repo-sha/' + other + '/SKILL.md']: doc('Review'),
    'repo-sha/.agents/skills/other/SKILL.md': doc('other'),
    'repo-sha/skills/broken/SKILL.md': strToU8('---\nname: nope\n---'),
  }),
);

describe('GitHub skill collection import', () => {
  let userId: string;
  let db: Awaited<ReturnType<typeof getTestDB>>;
  let importer: SkillImporter;
  let model: AgentSkillModel;

  beforeEach(async () => {
    userId = randomUUID();
    db = await getTestDB();
    await db.insert(users).values({ id: userId });
    importer = new SkillImporter(db, userId);
    model = new AgentSkillModel(db, userId);
    vi.spyOn(GitHub.prototype, 'resolveCommit').mockResolvedValue(commit);
    vi.spyOn(GitHub.prototype, 'downloadCommitZip').mockResolvedValue(zip);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(globalFiles).where(eq(globalFiles.creator, userId));
  });

  it('pins a batch, isolates errors, and reuses the row from the single import entry', async () => {
    const scan = await importer.discoverGitHubSkills(repo);
    expect(scan.candidates).toHaveLength(4);
    expect(scan.candidates.find((item) => item.path === 'skills/broken')?.status).toBe('invalid');
    const batch = {
      ...scan,
      gitUrl: repo,
      selections: [
        { path: review, revision: null },
        { path: other, revision: null },
      ],
    };
    expect(await importer.importGitHubSkills(batch)).toEqual([
      { path: review, status: 'created' },
      { path: other, status: 'conflict' },
    ]);
    expect(GitHub.prototype.resolveCommit).toHaveBeenCalledTimes(1);
    expect(GitHub.prototype.downloadCommitZip).toHaveBeenCalledTimes(2);
    expect(GitHub.prototype.downloadCommitZip).toHaveBeenLastCalledWith(expect.anything(), commit);
    expect(
      (await importer.importFromGitHub({ gitUrl: repo + '/tree/main/' + review })).status,
    ).toBe('unchanged');
    expect((await importer.importGitHubSkills(batch))[0].status).toBe('unchanged');
    expect((await model.findAll()).total).toBe(1);
  });

  it('coalesces concurrent submissions of the same selection', async () => {
    const scan = await importer.discoverGitHubSkills(repo);
    const batch = { ...scan, gitUrl: repo, selections: [{ path: review, revision: null }] };
    const results = await Promise.all([
      importer.importGitHubSkills(batch),
      importer.importGitHubSkills(batch),
    ]);
    expect(results.map(([row]) => row.status).sort()).toEqual(['created', 'unchanged']);
    expect((await model.findAll()).total).toBe(1);
  });

  it('limits collection and file URLs to their original scope', async () => {
    const url = repo + '/tree/main/skills/team';
    const scan = await importer.discoverGitHubSkills(url);
    expect(scan.candidates.map((row) => row.path)).toEqual([review]);
    expect(
      (await importer.discoverGitHubSkills(repo + '/blob/main/' + review + '/SKILL.md')).candidates,
    ).toEqual(scan.candidates);
    expect(
      await importer.importGitHubSkills({
        ...scan,
        gitUrl: url,
        selections: [{ path: other, revision: null }],
      }),
    ).toEqual([{ path: other, status: 'failed' }]);
    expect((await model.findAll()).total).toBe(0);
  });

  it('preserves a legacy row, rejects stale previews and keeps local edits', async () => {
    const row = await model.create({
      content: 'Old',
      description: 'Old',
      identifier: 'owner-collection-review',
      name: 'review',
      source: 'market',
      manifest: { name: 'review', description: 'Old', sourceUrl: repo + '/tree/main/' + review },
    });
    const scan = await importer.discoverGitHubSkills(repo);
    const selection = scan.candidates.find((item) => item.path === review)!;
    expect(selection.status).toBe('update');
    expect(scan.candidates.find((item) => item.path === other)?.status).toBe('conflict');
    await model.update(row.id, { content: 'Concurrent edit' });
    expect(
      await importer.importGitHubSkills({ ...scan, gitUrl: repo, selections: [selection] }),
    ).toEqual([{ path: review, status: 'conflict' }]);
    expect((await model.findById(row.id))?.content).toBe('Concurrent edit');
    const fresh = await importer.discoverGitHubSkills(repo);
    expect(
      (
        await importer.importGitHubSkills({
          ...fresh,
          gitUrl: repo,
          selections: fresh.candidates.filter((item) => item.path === review),
        })
      )[0].status,
    ).toBe('updated');
    expect((await model.findById(row.id))?.identifier).toBe(row.identifier);
  });

  it('checks a shared snapshot once, updates only the changed package and protects local edits', async () => {
    const sibling = '.agents/skills/other';
    const scan = await importer.discoverGitHubSkills(repo);
    await importer.importGitHubSkills({
      ...scan,
      gitUrl: repo,
      selections: [review, sibling].map((path) => ({ path, revision: null })),
    });
    const a = (await model.findByName('review'))!;
    const b = (await model.findByName('other'))!;
    expect(a.upstream).toMatchObject({ path: review, ref: 'HEAD', installedCommit: commit });
    const next = 'b'.repeat(40);
    vi.mocked(GitHub.prototype.resolveCommit).mockResolvedValue(next);
    vi.mocked(GitHub.prototype.downloadCommitZip)
      .mockClear()
      .mockResolvedValue(
        Buffer.from(
          zipSync({
            ['repo-new/' + review + '/SKILL.md']: doc('review'),
            ['repo-new/' + review + '/scripts/run.sh']: strToU8('echo updated'),
            ['repo-new/' + sibling + '/SKILL.md']: doc('other'),
          }),
        ),
      );
    const checks = await importer.checkGitHubUpdates();
    expect(checks[a.id]).toMatchObject({ commit: next, localChanges: false, status: 'update' });
    expect(checks[b.id]).toEqual({ status: 'current' });
    expect(GitHub.prototype.downloadCommitZip).toHaveBeenCalledTimes(1);
    const before = checks[a.id];
    if (before.status !== 'update') throw new Error('Expected update');
    await model.update(a.id, { content: 'My edited instructions' });
    await expect(importer.applyGitHubUpdate({ ...before, id: a.id })).rejects.toThrow(/changed/);
    const edited = (await importer.checkGitHubUpdates())[a.id];
    if (edited.status !== 'update') throw new Error('Expected update');
    expect(edited.localChanges).toBe(true);
    await expect(importer.applyGitHubUpdate({ ...edited, id: a.id })).rejects.toThrow(
      /local changes/,
    );
    expect((await model.findById(a.id))?.content).toBe('My edited instructions');
    const result = await importer.applyGitHubUpdate({ ...edited, id: a.id, overwriteLocal: true });
    expect(result.skill).toMatchObject({
      id: a.id,
      identifier: a.identifier,
      upstream: { installedCommit: next },
    });
    expect(result.skill.resources?.['scripts/run.sh']).toBeDefined();
    expect((await model.findById(b.id))?.zipFileHash).toEqual(b.zipFileHash);
    expect((await importer.checkGitHubUpdates())[a.id]).toEqual({ status: 'current' });
  });

  it('applies the previewed commit with one click even if the branch advances again', async () => {
    const { skill } = await importer.importFromGitHub({ gitUrl: repo + '/tree/release/' + review });
    const next = 'd'.repeat(40);
    vi.mocked(GitHub.prototype.resolveCommit).mockResolvedValue(next);
    vi.mocked(GitHub.prototype.downloadCommitZip).mockResolvedValue(
      Buffer.from(
        zipSync({
          ['repo-new/' + review + '/SKILL.md']: strToU8(
            '---\nname: review\ndescription: Updated\n---\nUse the new instructions',
          ),
        }),
      ),
    );
    const preview = (await importer.checkGitHubUpdates())[skill.id];
    if (preview.status !== 'update') throw new Error('Expected update');
    expect(preview.localChanges).toBe(false);
    vi.mocked(GitHub.prototype.resolveCommit).mockResolvedValue('e'.repeat(40));
    const { skill: updated } = await importer.applyGitHubUpdate({ id: skill.id, ...preview });
    expect(updated).toMatchObject({
      id: skill.id,
      identifier: skill.identifier,
      upstream: { ref: 'release', installedCommit: next },
    });
    expect(updated.content).toContain('Use the new instructions');
    expect(GitHub.prototype.downloadCommitZip).toHaveBeenLastCalledWith(expect.anything(), next);
  });

  it('keeps explicit commit installs pinned and lets a legacy snapshot opt into a branch', async () => {
    const { skill } = await importer.importFromGitHub({
      gitUrl: repo + '/tree/' + commit + '/' + review,
    });
    expect((await importer.checkGitHubUpdates())[skill.id]).toEqual({ status: 'pinned' });
    await model.replaceImportedSkill(skill, { upstream: null });
    const legacy = (await importer.checkGitHubUpdates())[skill.id];
    if (legacy.status !== 'chooseRef') throw new Error('Expected branch choice');
    await importer.trackLegacyGitHubSkill(skill.id, legacy.revision, 'release/stable');
    expect((await model.findById(skill.id))?.upstream).toMatchObject({
      ref: 'release/stable',
      installedCommit: commit,
    });
  });

  it('reports a removed directory separately from an unavailable source and keeps the installation', async () => {
    const { skill } = await importer.importFromGitHub({ gitUrl: repo + '/tree/main/' + review });
    vi.mocked(GitHub.prototype.resolveCommit).mockResolvedValue('c'.repeat(40));
    vi.mocked(GitHub.prototype.downloadCommitZip).mockResolvedValue(
      Buffer.from(zipSync({ 'repo-new/README.md': doc('docs') })),
    );
    expect((await importer.checkGitHubUpdates())[skill.id]).toEqual({ status: 'missing' });
    vi.mocked(GitHub.prototype.resolveCommit).mockRejectedValue(new Error('offline'));
    expect((await importer.checkGitHubUpdates())[skill.id]).toEqual({ status: 'unavailable' });
    expect((await model.findById(skill.id))?.zipFileHash).toEqual(skill.zipFileHash);
  });

  it('checks the library and creator permissions again when committing', async () => {
    const workspaceId = randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Skill imports',
      slug: workspaceId,
      primaryOwnerId: userId,
    });
    try {
      const owner = new SkillImporter(db, userId, workspaceId, { workspaceRole: 'owner' });
      const scan = await owner.discoverGitHubSkills(repo);
      const batch = { ...scan, gitUrl: repo, selections: [{ path: review, revision: null }] };
      await expect(importer.importGitHubSkills(batch)).rejects.toThrow(/library changed/);
      expect((await owner.importGitHubSkills(batch))[0].status).toBe('created');
      const workspace = new AgentSkillModel(db, userId, workspaceId);
      const [row] = (await workspace.findAll()).data;
      await workspace.update(row.id, { content: 'Local edit' });
      const member = new SkillImporter(db, randomUUID(), workspaceId, { workspaceRole: 'member' });
      const preview = await member.discoverGitHubSkills(repo);
      const selected = preview.candidates.find((item) => item.path === review)!;
      expect(selected.status).toBe('forbidden');
      expect(
        (await member.importGitHubSkills({ ...preview, gitUrl: repo, selections: [selected] }))[0]
          .status,
      ).toBe('forbidden');
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });
});
