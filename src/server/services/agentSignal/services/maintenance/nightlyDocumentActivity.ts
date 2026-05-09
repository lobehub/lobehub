import type { AgentSignalDocumentActivityRow } from '@/database/models/agentSignal/reviewContext';

import type { DocumentActivityDigest } from './nightlyCollector';

/**
 * Maps database document activity rows into nightly maintenance buckets.
 *
 * Use when:
 * - Server runtime adapters need to keep DB row shape separate from reviewer context shape
 * - Tests need deterministic document bucket behavior without opening database connections
 *
 * Expects:
 * - Rows are already scoped to one user, one agent, and one review window
 *
 * Returns:
 * - Document activity buckets where only skill bucket rows can support skill maintenance
 */
export const mapNightlyDocumentActivityRows = (
  rows: AgentSignalDocumentActivityRow[],
): DocumentActivityDigest => {
  const digest: DocumentActivityDigest = {
    ambiguousBucket: [],
    excludedSummary: { count: 0, reasons: [] },
    generalDocumentBucket: [],
    skillBucket: [],
  };

  for (const row of rows) {
    const base = {
      agentDocumentId: row.agentDocumentId,
      documentId: row.documentId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };

    if (row.hintIsSkill === true) {
      digest.skillBucket.push({
        ...base,
        hintIsSkill: true,
        reason: 'metadata.agentSignal.hintIsSkill=true',
        skillFileType: row.policyLoadFormat,
      });
      continue;
    }

    if (row.templateId === 'skills/index' || row.templateId === 'skills/bundle') {
      digest.skillBucket.push({
        ...base,
        hintIsSkill: false,
        reason: `templateId=${row.templateId}`,
        skillFileType: row.templateId,
      });
      continue;
    }

    if (row.hintIsSkill === false) {
      digest.generalDocumentBucket.push({
        ...base,
        reason: 'metadata.agentSignal.hintIsSkill=false',
      });
      continue;
    }

    digest.ambiguousBucket.push({
      ...base,
      reason: 'missing agentSignal hint metadata',
    });
  }

  return digest;
};
