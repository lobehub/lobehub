import { describe, expect, it } from 'vitest';

import {
  buildDeliverables,
  dedupeArtifacts,
  evidenceCites,
  filterDeliverables,
  groupDeliverables,
} from './deliverableList';
import type { GoalArtifactView } from './goalGraphViewModel';
import type { CriterionOutcome } from './goalResultState';

let seq = 0;
const artifact = (patch: Partial<GoalArtifactView> = {}): GoalArtifactView => {
  seq += 1;
  return {
    createdAt: new Date(2026, 8, 1, 0, seq),
    identifier: null,
    nodeId: 'n1',
    relation: 'produced',
    resourceId: null,
    title: `item ${seq}`,
    type: 'document',
    url: null,
    workId: `w${seq}`,
    workVersionId: `v${seq}`,
    ...patch,
  };
};

const outcome = (id: string, evidence: CriterionOutcome['evidence']): CriterionOutcome => ({
  criterion: { id, title: `criterion ${id}` },
  evidence,
  state: 'passed',
});

const titles: Record<string, string> = { n1: '整理定价', n2: '采集截图', n3: '写报告', n4: '访谈' };
const titleOf = (nodeId: string) => titles[nodeId];

describe('dedupeArtifacts', () => {
  it('keeps one row per version, under the node that produced it', () => {
    const produced = artifact({ nodeId: 'n1', workVersionId: 'same' });
    const input = artifact({ nodeId: 'n2', relation: 'input', workVersionId: 'same' });

    expect(dedupeArtifacts([input, produced])).toEqual([produced]);
    expect(dedupeArtifacts([produced, input])).toEqual([produced]);
  });
});

describe('evidenceCites', () => {
  it('matches a document by id, a file by file id or url, and a link by url in the text', () => {
    const doc = artifact({ resourceId: 'docs_1', type: 'document' });
    const file = artifact({ fileId: 'file_1', type: 'file', url: 'https://cdn/x.zip' });
    const link = artifact({ type: 'external', url: 'https://tana.inc/pricing' });

    expect(evidenceCites(doc, { documentId: 'docs_1', id: 'e', type: 'markdown' })).toBe(true);
    expect(evidenceCites(doc, { documentId: 'docs_2', id: 'e', type: 'markdown' })).toBe(false);
    expect(evidenceCites(file, { fileId: 'file_1', id: 'e', type: 'screenshot' })).toBe(true);
    expect(evidenceCites(file, { fileUrl: 'https://cdn/x.zip', id: 'e', type: 'file' })).toBe(true);
    expect(
      evidenceCites(link, { content: 'see https://tana.inc/pricing', id: 'e', type: 'text' }),
    ).toBe(true);
    expect(evidenceCites(link, { content: 'nothing', id: 'e', type: 'text' })).toBe(false);
  });
});

describe('buildDeliverables', () => {
  it('leads with the main deliverable and lists which criteria cite each item', () => {
    const report = artifact({ nodeId: 'n3', resourceId: 'docs_report' });
    const sheet = artifact({ fileId: 'file_sheet', nodeId: 'n1', type: 'file' });
    const items = buildDeliverables({
      artifacts: [sheet, report],
      outcomes: [
        outcome('c1', [{ documentId: 'docs_report', id: 'e1', type: 'markdown' }]),
        outcome('c2', [
          { documentId: 'docs_report', id: 'e2', type: 'markdown' },
          { fileId: 'file_sheet', id: 'e3', type: 'file' },
        ]),
      ],
      primaryResourceId: 'docs_report',
      titleOf,
    });

    expect(items.map((item) => [item.artifact.workVersionId, item.primary])).toEqual([
      [report.workVersionId, true],
      [sheet.workVersionId, false],
    ]);
    expect(items[0].citedBy.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(items[1].citedBy.map((c) => c.id)).toEqual(['c2']);
    expect(items[0].producerTitle).toBe('写报告');
  });
});

describe('filterDeliverables', () => {
  const items = buildDeliverables({
    artifacts: [
      artifact({ nodeId: 'n1', title: '定价对比表.xlsx', type: 'file' }),
      artifact({ nodeId: 'n1', title: 'Tana 定价公告', type: 'external' }),
      artifact({ nodeId: 'n2', title: 'Tana-pricing.png', type: 'file' }),
      artifact({ nodeId: 'n4', title: '访谈纪要', type: 'document' }),
    ],
    outcomes: [],
    titleOf,
  });

  it('narrows by type', () => {
    expect(filterDeliverables(items, { query: '', type: 'file' })).toHaveLength(2);
  });

  it('searches title and producing task, case-insensitively', () => {
    expect(
      filterDeliverables(items, { query: 'tana', type: 'all' }).map((i) => i.artifact.title),
    ).toEqual(['Tana-pricing.png', 'Tana 定价公告']);
    expect(filterDeliverables(items, { query: '采集', type: 'all' })).toHaveLength(1);
    expect(filterDeliverables(items, { query: '飞书', type: 'all' })).toEqual([]);
  });
});

describe('groupDeliverables', () => {
  it('groups by producing task and folds single-item tasks into one trailing group', () => {
    const items = buildDeliverables({
      artifacts: [
        artifact({ nodeId: 'n1' }),
        artifact({ nodeId: 'n1' }),
        artifact({ nodeId: 'n2' }),
        artifact({ nodeId: 'n2' }),
        artifact({ nodeId: 'n2' }),
        artifact({ nodeId: 'n3' }),
        artifact({ nodeId: 'n4' }),
      ],
      outcomes: [],
      titleOf,
    });

    const groups = groupDeliverables(items);
    expect(groups.map((group) => [group.title, group.items.length])).toEqual([
      ['采集截图', 3],
      ['整理定价', 2],
      [undefined, 2],
    ]);
  });

  it('stays flat when there is nothing to separate', () => {
    const items = buildDeliverables({
      artifacts: [artifact({ nodeId: 'n1' }), artifact({ nodeId: 'n2' })],
      outcomes: [],
      titleOf,
    });
    expect(groupDeliverables(items)).toEqual([{ items }]);
  });
});
