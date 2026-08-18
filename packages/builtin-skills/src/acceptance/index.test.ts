import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const readMarkdownBundle = (directory: string): string =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readMarkdownBundle(filePath);
      return entry.name.endsWith('.md') ? readFileSync(filePath, 'utf8') : [];
    })
    .join('\n');

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

  it('keeps the latest evidence and multi-round acceptance contracts', () => {
    expect(skillBundle).toContain('Dual text evidence for non-visual behavior');
    expect(skillContent).toContain('lh acceptance view <acceptanceId | type:id> --json');
    expect(skillContent).toContain("supersedes: ['old-id']");
    expect(skillContent).toContain('--requirement "<one-sentence business goal>"');
  });
});
