import { describe, expect, it } from 'vitest';

import type { ProjectionTableCell } from './model';
import {
  createProjectionPropertyCell,
  getProjectionPropertyEntries,
  getProjectionPropertyKind,
  getProjectionPropertySummary,
} from './propertyTree';

const rootCell: ProjectionTableCell = {
  column: {
    fieldName: 'profile',
    id: 'field:profile',
    kind: 'field',
    label: 'profile',
    width: 260,
  },
  displayValue: '{"identity":{"title":"Reviewer"}}',
  editTarget: {
    fragmentName: 'profile',
    projection: {
      entryKey: 'scope::agent::agent-1',
      record: {
        fragments: {
          profile: {
            data: { description: 'Reviewer', slug: 'reviewer' },
            observedAt: 10,
            source: 'network',
          },
        },
        id: 'agent-1',
        kind: 'agent',
      },
      scope: 'scope',
    },
    type: 'fragment',
  },
  key: 'scope::agent::agent-1:field:profile',
  title: '{\n  "identity": {\n    "title": "Reviewer"\n  }\n}',
  value: { identity: { title: 'Reviewer' } },
};

describe('Projection property tree', () => {
  it('describes object and array containers for compact scanning', () => {
    expect(getProjectionPropertyKind(rootCell.value)).toBe('object');
    expect(getProjectionPropertySummary(rootCell.value)).toBe('1 field');
    expect(getProjectionPropertySummary(['first', 'second'])).toBe('2 items');
    expect(getProjectionPropertyEntries(['first'])).toEqual([
      { label: '[0]', segment: 0, value: 'first' },
    ]);
  });

  it('builds nested editable cells with a stable path to the root value', () => {
    const identityEntry = getProjectionPropertyEntries(rootCell.value)[0];
    const identityCell = createProjectionPropertyCell(rootCell, identityEntry);
    const titleEntry = getProjectionPropertyEntries(identityEntry.value)[0];
    const titleCell = createProjectionPropertyCell(identityCell, titleEntry);

    expect(titleCell).toMatchObject({
      column: { label: 'title' },
      displayValue: 'Reviewer',
      editTarget: { path: ['identity', 'title'], type: 'fragment' },
      value: 'Reviewer',
    });
    expect(titleCell.key).toContain('["identity","title"]');
  });
});
