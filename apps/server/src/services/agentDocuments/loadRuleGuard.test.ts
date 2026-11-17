// @vitest-environment node
import { AGENT_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { DOCUMENT_FOLDER_TYPE } from '@lobechat/database/schemas';
import { describe, expect, it } from 'vitest';

import { assertLoadModeChangeAllowed } from './loadRuleGuard';

const doc = (overrides: { fileType?: string; templateId?: string | null } = {}) => ({
  fileType: AGENT_DOCUMENT_FILE_TYPE,
  templateId: null,
  ...overrides,
});

describe('assertLoadModeChangeAllowed', () => {
  it('lets an ordinary document switch mode', () => {
    expect(() => assertLoadModeChangeAllowed(doc(), { mode: 'always' })).not.toThrow();
    expect(() => assertLoadModeChangeAllowed(doc(), { mode: 'progressive' })).not.toThrow();
  });

  it('leaves cap and priority updates alone on any document', () => {
    expect(() => assertLoadModeChangeAllowed(doc({ templateId: 'agent-skill' }), {})).not.toThrow();
    expect(() =>
      assertLoadModeChangeAllowed(doc({ fileType: DOCUMENT_FOLDER_TYPE }), {}),
    ).not.toThrow();
  });

  // Skills stay out of document context on purpose; "always" would inject the
  // SKILL.md body on every call on top of the skills listing.
  it('refuses to change the mode of a managed skill document', () => {
    expect(() =>
      assertLoadModeChangeAllowed(doc({ templateId: 'agent-skill' }), { mode: 'always' }),
    ).toThrow(
      expect.objectContaining({
        code: 'METHOD_NOT_SUPPORTED',
        message:
          'Skill documents are loaded through the skills system; their load mode cannot be changed.',
      }),
    );
    expect(() =>
      assertLoadModeChangeAllowed(doc({ fileType: 'skills/index' }), { mode: 'always' }),
    ).toThrow(expect.objectContaining({ code: 'METHOD_NOT_SUPPORTED' }));
  });

  it('refuses a folder, which has no content to load', () => {
    expect(() =>
      assertLoadModeChangeAllowed(doc({ fileType: DOCUMENT_FOLDER_TYPE }), { mode: 'always' }),
    ).toThrow(
      expect.objectContaining({
        code: 'METHOD_NOT_SUPPORTED',
        message:
          'Folders have no content to load; set the load mode on the documents inside the folder instead.',
      }),
    );
  });
});
