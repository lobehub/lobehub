import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_FILE_TYPE,
  AGENT_DOCUMENT_SKILL_CATEGORY,
  AGENT_DOCUMENT_SOURCE_TYPE,
  AGENT_DOCUMENT_WEB_CATEGORY,
  AGENT_SIGNAL_SOURCE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  WEB_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { deriveAgentDocumentFields } from '../deriveFields';

describe('deriveAgentDocumentFields', () => {
  it('categorizes managed skill bundles as skills and marks them as folders', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/bundle',
        sourceType: AGENT_SIGNAL_SOURCE_TYPE,
        templateId: 'agent-skill',
      }),
    ).toEqual({
      category: AGENT_DOCUMENT_SKILL_CATEGORY,
      isFolder: true,
      isSkillBundle: true,
      isSkillIndex: false,
    });
  });

  it('categorizes SKILL.md index documents as skills (but not as folders)', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/index',
        sourceType: AGENT_SIGNAL_SOURCE_TYPE,
        templateId: 'agent-skill',
      }),
    ).toEqual({
      category: AGENT_DOCUMENT_SKILL_CATEGORY,
      isFolder: false,
      isSkillBundle: false,
      isSkillIndex: true,
    });
  });

  it('treats any skills/* fileType as a managed skill even without the template id', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'skills/bundle',
        sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
        templateId: null,
      }).category,
    ).toBe(AGENT_DOCUMENT_SKILL_CATEGORY);
  });

  it('classifies web-sourced articles as web', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: 'article',
        sourceType: WEB_DOCUMENT_SOURCE_TYPE,
        templateId: null,
      }),
    ).toEqual({
      category: AGENT_DOCUMENT_WEB_CATEGORY,
      isFolder: false,
      isSkillBundle: false,
      isSkillIndex: false,
    });
  });

  it('marks custom folders as folders without changing the category', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
        templateId: null,
      }),
    ).toEqual({
      category: AGENT_DOCUMENT_CATEGORY,
      isFolder: true,
      isSkillBundle: false,
      isSkillIndex: false,
    });
  });

  it('falls back to document for ordinary file-backed agent documents', () => {
    expect(
      deriveAgentDocumentFields({
        fileType: AGENT_DOCUMENT_FILE_TYPE,
        sourceType: 'file',
        templateId: null,
      }),
    ).toEqual({
      category: AGENT_DOCUMENT_CATEGORY,
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
        sourceType: WEB_DOCUMENT_SOURCE_TYPE,
        templateId: 'agent-skill',
      }).category,
    ).toBe(AGENT_DOCUMENT_SKILL_CATEGORY);
  });
});
