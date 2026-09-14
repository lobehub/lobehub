// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  type DocumentRewriteOverlapCandidate,
  documentRewriteSelectionsOverlap,
} from './documentRewriteRequest.overlap';

const blockSelection = (
  startNodeId: string,
  endNodeId = startNodeId,
  startOffset = 0,
  endOffset = 10,
  targetNodeIds?: string[],
): DocumentRewriteOverlapCandidate => ({
  selection: {
    endNodeId,
    endOffset,
    kind: 'block',
    quotedText: 'selected text',
    quotedTextHash: 'hash:selected text',
    ...(targetNodeIds ? { targetNodeIds } : {}),
    startNodeId,
    startOffset,
  },
  targetNodeIds: targetNodeIds ?? [startNodeId],
});

describe('documentRewriteSelectionsOverlap', () => {
  it('uses half-open offsets for same-block ranges', () => {
    const left = blockSelection('node-a', 'node-a', 0, 5);

    expect(documentRewriteSelectionsOverlap(left, blockSelection('node-a', 'node-a', 5, 10))).toBe(
      false,
    );
    expect(documentRewriteSelectionsOverlap(left, blockSelection('node-a', 'node-a', 4, 10))).toBe(
      true,
    );
    expect(documentRewriteSelectionsOverlap(left, blockSelection('node-a', 'node-a', 0, 0))).toBe(
      false,
    );
  });

  it('compares cross-block ranges using the ordered target projection', () => {
    const left = blockSelection('node-a', 'node-c', 5, 5, ['node-a', 'node-b', 'node-c']);

    expect(
      documentRewriteSelectionsOverlap(
        left,
        blockSelection('node-c', 'node-d', 5, 2, ['node-c', 'node-d']),
      ),
    ).toBe(false);
    expect(
      documentRewriteSelectionsOverlap(
        left,
        blockSelection('node-b', 'node-d', 8, 2, ['node-b', 'node-c', 'node-d']),
      ),
    ).toBe(true);
    expect(
      documentRewriteSelectionsOverlap(left, blockSelection('node-a', 'node-a', 4, 6, ['node-a'])),
    ).toBe(true);
  });

  it('allows ranges on different blocks and rejects a whole-document target', () => {
    expect(
      documentRewriteSelectionsOverlap(
        blockSelection('node-a', 'node-a', 0, 5),
        blockSelection('node-b', 'node-b', 0, 5),
      ),
    ).toBe(false);
    expect(
      documentRewriteSelectionsOverlap(blockSelection('node-a'), {
        targetNodeIds: ['__document__'],
        selection: undefined,
      }),
    ).toBe(true);
  });

  it('reserves node targets exclusively and conflicts with text ranges on that node', () => {
    const artifactTarget: DocumentRewriteOverlapCandidate = {
      selection: {
        adapterId: 'artifact',
        endNodeId: 'artifact-1',
        endOffset: 1,
        kind: 'block',
        quotedText: 'Artifact card',
        quotedTextHash: 'hash:artifact',
        sourceHash: 'hash:source',
        startNodeId: 'artifact-1',
        startOffset: 0,
        targetKind: 'node',
        targetNodeId: 'artifact-1',
        targetNodeIds: ['artifact-1'],
      },
      targetNodeIds: ['artifact-1'],
    };
    const sameNodeText = blockSelection('artifact-1', 'artifact-1', 5, 6);
    const unprojectedSameNodeText = {
      ...sameNodeText,
      targetNodeIds: [],
    };
    const otherNode = blockSelection('paragraph-1', 'paragraph-1', 0, 5);
    const otherNodeTarget: DocumentRewriteOverlapCandidate = {
      selection: {
        adapterId: 'artifact',
        endNodeId: 'artifact-2',
        endOffset: 1,
        kind: 'block',
        quotedText: 'Artifact card',
        quotedTextHash: 'hash:artifact',
        sourceHash: 'hash:source',
        startNodeId: 'artifact-2',
        startOffset: 0,
        targetKind: 'node',
        targetNodeId: 'artifact-2',
        targetNodeIds: ['artifact-2'],
      },
      targetNodeIds: ['artifact-2'],
    };

    expect(documentRewriteSelectionsOverlap(artifactTarget, artifactTarget)).toBe(true);
    expect(documentRewriteSelectionsOverlap(artifactTarget, sameNodeText)).toBe(true);
    expect(documentRewriteSelectionsOverlap(artifactTarget, unprojectedSameNodeText)).toBe(true);
    expect(documentRewriteSelectionsOverlap(artifactTarget, otherNode)).toBe(false);
    expect(documentRewriteSelectionsOverlap(artifactTarget, otherNodeTarget)).toBe(false);
  });

  it('degrades legacy rows to known whole blocks without making every row global', () => {
    const legacyBlock: DocumentRewriteOverlapCandidate = {
      selection: { kind: 'block', quotedText: '', quotedTextHash: 'hash' },
      targetNodeIds: ['node-a'],
    };

    expect(documentRewriteSelectionsOverlap(legacyBlock, blockSelection('node-a'))).toBe(true);
    expect(documentRewriteSelectionsOverlap(legacyBlock, blockSelection('node-b'))).toBe(false);
    expect(
      documentRewriteSelectionsOverlap(
        legacyBlock,
        blockSelection('node-a', 'node-b', 0, 2, ['node-a', 'node-b']),
      ),
    ).toBe(true);
    expect(
      documentRewriteSelectionsOverlap(
        legacyBlock,
        blockSelection('node-c', 'node-d', 0, 2, ['node-c', 'node-d']),
      ),
    ).toBe(false);
    expect(
      documentRewriteSelectionsOverlap(
        { selection: undefined, targetNodeIds: [] },
        blockSelection('node-b'),
      ),
    ).toBe(true);
  });
});
