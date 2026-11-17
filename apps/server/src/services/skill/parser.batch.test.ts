import { MAX_BATCH_IMPORT_SKILLS } from '@lobechat/types';
import { unzip, zip } from 'fflate';
import { describe, expect, it } from 'vitest';

import { SkillParseError } from './errors';
import { SkillParser } from './parser';

const encode = (value: string) => new TextEncoder().encode(value);

const createZip = (files: Record<string, Uint8Array>): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

const extractZip = (data: Uint8Array): Promise<Record<string, Uint8Array>> =>
  new Promise((resolve, reject) => {
    unzip(data, (error, unzipped) => {
      if (error) reject(error);
      else resolve(unzipped);
    });
  });

const skillMd = (name: string, body = `# ${name}`) =>
  `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`;

describe('SkillParser.parseZipPackageBatch', () => {
  const parser = new SkillParser();

  it('parses every skill folder and scopes each package to its own files', async () => {
    const archive = await createZip({
      'skill-a/SKILL.md': encode(skillMd('skill-a')),
      'skill-a/scripts/run.sh': encode('echo a'),
      'skill-b/SKILL.md': encode(skillMd('skill-b')),
      'skill-b/references/rules.md': encode('# Rules'),
    });

    const { failures, skills } = await parser.parseZipPackageBatch(Buffer.from(archive));

    expect(failures).toEqual([]);
    expect(skills.map((skill) => skill.path)).toEqual(['skill-a', 'skill-b']);
    expect(skills.map((skill) => skill.manifest.name)).toEqual(['skill-a', 'skill-b']);
    expect([...skills[0].resources.keys()]).toEqual(['scripts/run.sh']);
    expect([...skills[1].resources.keys()]).toEqual(['references/rules.md']);
    expect(skills[0].zipHash).not.toBe(skills[1].zipHash);

    const repacked = await extractZip(skills[0].skillZipBuffer);
    expect(Object.keys(repacked).sort()).toEqual(['SKILL.md', 'scripts/run.sh']);
    expect(new TextDecoder().decode(repacked['SKILL.md'])).toContain('# skill-a');
  });

  it('finds skills below a wrapper directory', async () => {
    const archive = await createZip({
      'skills-pack/skill-a/SKILL.md': encode(skillMd('skill-a')),
      'skills-pack/skill-b/SKILL.md': encode(skillMd('skill-b')),
      'skills-pack/README.md': encode('Collection readme'),
    });

    const { skills } = await parser.parseZipPackageBatch(Buffer.from(archive));

    expect(skills.map((skill) => skill.path)).toEqual([
      'skills-pack/skill-a',
      'skills-pack/skill-b',
    ]);
  });

  it('treats a nested SKILL.md as part of the outer skill', async () => {
    const archive = await createZip({
      'outer/SKILL.md': encode(skillMd('outer')),
      'outer/examples/demo/SKILL.md': encode(skillMd('demo')),
    });

    const { failures, skills } = await parser.parseZipPackageBatch(Buffer.from(archive));

    expect(failures).toEqual([]);
    expect(skills.map((skill) => skill.path)).toEqual(['outer']);
    expect(skills[0].resources.has('examples/demo/SKILL.md')).toBe(true);
  });

  it('reports unreadable folders without dropping the valid ones', async () => {
    const archive = await createZip({
      'bad/SKILL.md': encode('---\nname: bad\n---\nNo description'),
      'good/SKILL.md': encode(skillMd('good')),
    });

    const { failures, skills } = await parser.parseZipPackageBatch(Buffer.from(archive));

    expect(skills.map((skill) => skill.path)).toEqual(['good']);
    expect(failures).toHaveLength(1);
    expect(failures[0].path).toBe('bad');
    expect(failures[0].message).toContain('Invalid skill manifest');
  });

  it('ignores hidden files, macOS metadata and paths outside the archive', async () => {
    const archive = await createZip({
      '.hidden/SKILL.md': encode(skillMd('hidden')),
      '__MACOSX/skill/._SKILL.md': encode(skillMd('macos')),
      'good/SKILL.md': encode(skillMd('good')),
      'good/.DS_Store': encode('metadata'),
      '../escape/SKILL.md': encode(skillMd('escape')),
    });

    const { failures, skills } = await parser.parseZipPackageBatch(Buffer.from(archive));

    expect(failures).toEqual([]);
    expect(skills.map((skill) => skill.path)).toEqual(['good']);
    expect([...skills[0].resources.keys()]).toEqual([]);
  });

  it('rejects an archive without SKILL.md', async () => {
    const archive = await createZip({ 'README.md': encode('Nothing here') });

    await expect(parser.parseZipPackageBatch(Buffer.from(archive))).rejects.toThrow(
      SkillParseError,
    );
  });

  it('rejects an archive with more skills than a batch can hold', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index <= MAX_BATCH_IMPORT_SKILLS; index++) {
      files[`skill-${index}/SKILL.md`] = encode(skillMd(`skill-${index}`));
    }
    const archive = await createZip(files);

    await expect(parser.parseZipPackageBatch(Buffer.from(archive))).rejects.toThrow(
      /import at most/,
    );
  });
});
