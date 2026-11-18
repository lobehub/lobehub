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
    vi.spyOn(GitHub.prototype, 'downloadRepoZip').mockResolvedValue(zip);
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
