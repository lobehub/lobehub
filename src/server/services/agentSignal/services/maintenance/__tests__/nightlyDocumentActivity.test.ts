import { describe, expect, it } from 'vitest';

import { mapNightlyDocumentActivityRows } from '../nightlyDocumentActivity';

describe('mapNightlyDocumentActivityRows', () => {
  /**
   * @example
   * hintIsSkill true rows enter the skill bucket and false rows enter the general bucket.
   */
  it('buckets hinted skill and general document activity separately', () => {
    expect(
      mapNightlyDocumentActivityRows([
        {
          agentDocumentId: 'agent-doc-skill',
          documentId: 'doc-skill',
          hintIsSkill: true,
          policyLoadFormat: 'raw',
          templateId: null,
          title: 'YouTube comments skill',
          updatedAt: new Date('2026-05-09T18:10:00.000Z'),
        },
        {
          agentDocumentId: 'agent-doc-general',
          documentId: 'doc-general',
          hintIsSkill: false,
          policyLoadFormat: 'raw',
          templateId: null,
          title: 'Meeting notes',
          updatedAt: new Date('2026-05-09T18:11:00.000Z'),
        },
      ]),
    ).toEqual({
      ambiguousBucket: [],
      excludedSummary: { count: 0, reasons: [] },
      generalDocumentBucket: [
        expect.objectContaining({
          agentDocumentId: 'agent-doc-general',
          reason: 'metadata.agentSignal.hintIsSkill=false',
        }),
      ],
      skillBucket: [
        expect.objectContaining({
          agentDocumentId: 'agent-doc-skill',
          hintIsSkill: true,
          reason: 'metadata.agentSignal.hintIsSkill=true',
        }),
      ],
    });
  });

  /**
   * @example
   * Existing managed skill templates are still skill bucket evidence even without a hint.
   */
  it('buckets known skill template rows as skill activity', () => {
    expect(
      mapNightlyDocumentActivityRows([
        {
          agentDocumentId: 'agent-doc-index',
          documentId: 'doc-index',
          hintIsSkill: null,
          policyLoadFormat: 'raw',
          templateId: 'skills/index',
          title: 'Skill index',
          updatedAt: new Date('2026-05-09T18:10:00.000Z'),
        },
        {
          agentDocumentId: 'agent-doc-managed-skill',
          documentId: 'doc-managed-skill',
          hintIsSkill: null,
          policyLoadFormat: 'raw',
          templateId: 'agent-skill',
          title: 'Managed skill',
          updatedAt: new Date('2026-05-09T18:11:00.000Z'),
        },
      ]).skillBucket,
    ).toEqual([
      expect.objectContaining({
        agentDocumentId: 'agent-doc-index',
        hintIsSkill: false,
        reason: 'templateId=skills/index',
      }),
      expect.objectContaining({
        agentDocumentId: 'agent-doc-managed-skill',
        hintIsSkill: false,
        reason: 'templateId=agent-skill',
      }),
    ]);
  });
});
