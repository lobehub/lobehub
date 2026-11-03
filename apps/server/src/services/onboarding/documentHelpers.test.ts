import { describe, expect, it, vi } from 'vitest';

import { buildIdentityDocument, buildSoulDocument } from './documentHelpers';

vi.mock('@lobechat/agent-templates', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    SOUL_DOCUMENT: {
      ...actual.SOUL_DOCUMENT,
      content: '# SOUL.md - Who You Are\n\n## Core Truths\n\nYou are becoming someone.',
    },
  };
});

describe('buildIdentityDocument', () => {
  it('should render all identity fields', () => {
    const result = buildIdentityDocument({
      emoji: '🦊',
      name: 'Fox',
      nature: 'digital familiar',
      vibe: 'warm and curious',
    });

    expect(result).toContain('**Name:** Fox');
    expect(result).toContain('**Creature:** digital familiar');
    expect(result).toContain('**Vibe:** warm and curious');
    expect(result).toContain('**Emoji:** 🦊');
  });

  it('should handle missing optional fields gracefully', () => {
    const result = buildIdentityDocument({
      emoji: '🤖',
      name: 'Bot',
      nature: '',
      vibe: '',
    });

    expect(result).toContain('**Name:** Bot');
    expect(result).toContain('**Emoji:** 🤖');
  });
});

describe('buildSoulDocument', () => {
  it('should return base SOUL content when no profile exists', () => {
    const result = buildSoulDocument({ version: 1 });

    expect(result).toContain('# SOUL.md - Who You Are');
    expect(result).toContain('## Core Truths');
    expect(result).not.toContain('## About My Human');
  });

  it('should append identity summary when present', () => {
    const result = buildSoulDocument({
      profile: {
        identity: { summary: 'A software engineer who loves Rust.' },
      },
      version: 1,
    });

    expect(result).toContain('## About My Human');
    expect(result).toContain('A software engineer who loves Rust.');
  });

  it('should append all profile sections progressively', () => {
    const result = buildSoulDocument({
      profile: {
        identity: { summary: 'Engineer' },
        painPoints: { summary: 'Too many meetings' },
        workContext: {
          activeProjects: ['ProjectA', 'ProjectB'],
          interests: ['AI'],
          summary: 'Working on chat app',
          tools: ['VS Code'],
        },
        workStyle: { summary: 'Direct and concise' },
      },
      version: 1,
    });

    expect(result).toContain('## About My Human');
    expect(result).toContain('## How We Work Together');
    expect(result).toContain('## Current Context');
    expect(result).toContain('- **Active Projects:** ProjectA, ProjectB');
    expect(result).toContain('- **Interests:** AI');
    expect(result).toContain('- **Tools:** VS Code');
    expect(result).toContain('## Where I Can Help Most');
  });

  it('should omit sections with empty summaries', () => {
    const result = buildSoulDocument({
      profile: {
        identity: { summary: '' },
        workStyle: { summary: 'Direct' },
      },
      version: 1,
    });

    expect(result).not.toContain('## About My Human');
    expect(result).toContain('## How We Work Together');
  });
});
