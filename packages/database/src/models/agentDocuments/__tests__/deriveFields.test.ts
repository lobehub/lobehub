import { describe, expect, it } from 'vitest';

import { deriveAgentDocumentFields } from '../deriveFields';

describe('deriveAgentDocumentFields', () => {
  it('categorizes managed skill bundles as skills and marks them as folders', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/bundle',
        sourceType: 'agent-signal',
        templateId: 'agent-skill',
      }),
    ).toEqual({
      category: 'skill',
      isFolder: true,
      isSkillBundle: true,
      isSkillIndex: false,
    });
  });

  it('categorizes SKILL.md index documents as skills (but not as folders)', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/index',
        sourceType: 'agent-signal',
        templateId: 'agent-skill',
      }),
    ).toEqual({
      category: 'skill',
      isFolder: false,
      isSkillBundle: false,
      isSkillIndex: true,
    });
  });

  it('treats any skills/* fileType as a managed skill even without the template id', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/bundle',
        sourceType: 'agent',
        templateId: null,
      }).category,
    ).toBe('skill');
  });

  it('classifies web-sourced articles as web', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'article',
        sourceType: 'web',
        templateId: null,
      }),
    ).toEqual({
      category: 'web',
      isFolder: false,
      isSkillBundle: false,
      isSkillIndex: false,
    });
  });

  it('marks custom folders as folders without changing the category', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'custom/folder',
        sourceType: 'agent',
        templateId: null,
      }),
    ).toEqual({
      category: 'document',
      isFolder: true,
      isSkillBundle: false,
      isSkillIndex: false,
    });
  });

  it('falls back to document for ordinary file-backed agent documents', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'agent/document',
        sourceType: 'file',
        templateId: null,
      }),
    ).toEqual({
      category: 'document',
      isFolder: false,
      isSkillBundle: false,
      isSkillIndex: false,
    });
  });

  it('prefers the skill classification when sourceType is web but the doc is template-managed', () => {
    // Defensive: even if a managed skill row ever carried sourceType='web',
    // the template id should still win over the web bucket.
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/index',
        sourceType: 'web',
        templateId: 'agent-skill',
      }).category,
    ).toBe('skill');
  });
});
