import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AcceptanceSkill } from './index';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const readMarkdownBundle = (directory: string): string =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readMarkdownBundle(filePath);
      return entry.name.endsWith('.md') ? readFileSync(filePath, 'utf8') : [];
    })
    .join('\n');

const listMarkdown = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdown(filePath);
    return entry.name.endsWith('.md') ? [path.relative(skillDir, filePath)] : [];
  });

const skillContent = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const skillBundle = readMarkdownBundle(skillDir);

describe('AcceptanceSkill', () => {
  it('exposes only the acceptance path in user-facing handoff guidance', () => {
    const internalRunPath = ['', 'verify'].join('/');

    expect(skillBundle).not.toContain(internalRunPath);
    expect(skillContent).toContain('/acceptance/<acceptanceId>');
    expect(skillContent).toContain(
      'Put no images, local paths, local file links, or internal run-page paths',
    );
  });

  it('ships every reference on disk — an unregistered file never reaches a builder', () => {
    // The bundle is built from `resources`, not from the directory: a reference
    // added to the folder but not registered here is invisible to every puller
    // while still looking present in the repo.
    const onDisk = listMarkdown(skillDir)
      .filter((file) => file !== 'SKILL.md')
      .sort();

    expect(Object.keys(AcceptanceSkill.resources ?? {}).sort()).toEqual(onDisk);
  });

  it('carries a version parsed from its own SKILL.md frontmatter', () => {
    // The version must reach the bundle, not just sit in the markdown: an
    // installer compares `bundle.version` against the copy already on disk, and
    // a version only a human can read makes that impossible.
    expect(skillContent).toMatch(/^version: \d+\.\d+\.\d+$/m);
    expect(AcceptanceSkill.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names no host environment variable — the skill needs no ambient ids', () => {
    // The skill is portable and runs anywhere. Instructing a builder to read
    // `$LOBEHUB_TOPIC_ID` / `$LOBE_OPERATION_ID` both couples it to one host and
    // invites it to hunt for an id that is absent by design; the CLI resolves
    // subject and origin from its own env without the agent's help.
    expect(skillBundle).not.toMatch(/LOBEHUB_[A-Z_]+/);
    expect(skillBundle).not.toMatch(/LOBE_OPERATION_ID/);
  });

  it('routes to the project layer before touching an environment', () => {
    expect(skillContent).toContain('.agents/acceptance/');
    expect(skillContent).toContain('PROCESS.md');
    expect(skillContent).toContain('project-adapter.md');
  });

  it('keeps the latest evidence and multi-round acceptance contracts', () => {
    expect(skillBundle).toContain('Dual text evidence for non-visual behavior');
    expect(skillContent).toContain('lh acceptance view <acceptanceId | type:id> --json');
    expect(skillContent).toContain("supersedes: ['old-id']");
    expect(skillContent).toContain('--requirement "<one-sentence business goal>"');
  });
});
