import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { readGitHubArchive } from './githubArchive';
import { SkillParser } from './parser';

const archive = () =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          'repo-sha/SKILL.md': '# Router\n\nRoute requests',
          'repo-sha/docs/guide.md': 'guide',
          'repo-sha/.agents/skills/review/SKILL.md': '# Review\n\nReview code',
          'repo-sha/.agents/skills/review/script.js': 'run',
          'repo-sha/node_modules/tool/SKILL.md': '# Dependency',
        }).map(([path, body]) => [path, strToU8(body)]),
      ),
    ),
  );

describe('GitHub collections', () => {
  it('finds nested skills and assigns resources to the closest owning skill', async () => {
    const skills = await readGitHubArchive(archive());
    expect([...skills.keys()].sort()).toEqual(['', '.agents/skills/review']);
    const root = await new SkillParser().parseGitHubDirectory(skills.get('')!, 'repo');
    expect([...root.resources.keys()]).toEqual(['docs/guide.md']);
    const child = await new SkillParser().parseGitHubDirectory(
      skills.get('.agents/skills/review')!,
      'review',
    );
    expect(child.manifest.name).toBe('Review');
    expect([...child.resources.keys()]).toEqual(['script.js']);
  });
});
