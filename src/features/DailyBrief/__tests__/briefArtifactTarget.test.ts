import { describe, expect, it } from 'vitest';

import { resolveBriefArtifactTarget } from '../briefArtifactTarget';

const SKILL_AGENT_DOCUMENT_ID = '5b0f0a9e-6c3c-4d55-9f3a-1b2c3d4e5f60';

describe('resolveBriefArtifactTarget', () => {
  it('opens a skill artifact as the agent skill, not as a page', () => {
    // The id is an `agent_documents` id: opened as a page it is a 404.
    expect(
      resolveBriefArtifactTarget(
        { id: SKILL_AGENT_DOCUMENT_ID, kind: 'skill', title: 'LOBE Marker Cleanup' },
        'agt_reviewed',
      ),
    ).toEqual({ agentDocumentId: SKILL_AGENT_DOCUMENT_ID, agentId: 'agt_reviewed', type: 'skill' });
  });

  it('has nothing to open for a skill artifact without its agent', () => {
    expect(
      resolveBriefArtifactTarget({ id: SKILL_AGENT_DOCUMENT_ID, kind: 'skill', title: null }),
    ).toBeUndefined();
  });

  it('opens any other artifact as the page it names', () => {
    expect(
      resolveBriefArtifactTarget(
        { id: 'docs_report', kind: 'text/markdown', title: 'Report' },
        'agt_reviewed',
      ),
    ).toEqual({ documentId: 'docs_report', type: 'page' });
    expect(resolveBriefArtifactTarget({ id: 'docs_note', kind: null, title: null })).toEqual({
      documentId: 'docs_note',
      type: 'page',
    });
  });
});
