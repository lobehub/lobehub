import { isPlainRecord } from '@lobechat/utils/object';

import type { ProjectionDevtoolValuePath } from '@/projection/devtools';

import type { ProjectionTableCell } from './model';
import { serializeProjectionCellValue } from './model';

export interface ProjectionPropertyEntry {
  label: string;
  segment: number | string;
  value: unknown;
}

export const getProjectionPropertyKind = (value: unknown): string => {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  if (isPlainRecord(value)) return 'object';
  return typeof value;
};

export const isProjectionPropertyContainer = (
  value: unknown,
): value is Record<string, unknown> | unknown[] => Array.isArray(value) || isPlainRecord(value);

export const getProjectionPropertyEntries = (value: unknown): ProjectionPropertyEntry[] => {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ label: `[${index}]`, segment: index, value: item }));
  }
  if (!isPlainRecord(value)) return [];

  return Object.entries(value).map(([label, item]) => ({ label, segment: label, value: item }));
};

export const getProjectionPropertySummary = (value: unknown): string => {
  const entries = getProjectionPropertyEntries(value);
  if (Array.isArray(value)) return `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
  if (isPlainRecord(value)) {
    return `${entries.length} ${entries.length === 1 ? 'field' : 'fields'}`;
  }
  return getProjectionPropertyKind(value);
};

export const createProjectionPropertyCell = (
  parentCell: ProjectionTableCell,
  entry: ProjectionPropertyEntry,
): ProjectionTableCell => {
  const parentPath = parentCell.editTarget?.path ?? [];
  const path: ProjectionDevtoolValuePath = [...parentPath, entry.segment];
  const displayValue =
    entry.value === undefined ? 'undefined' : serializeProjectionCellValue(entry.value);

  return {
    column: {
      ...parentCell.column,
      id: `${parentCell.column.id}:${JSON.stringify(entry.segment)}`,
      label: entry.label,
    },
    displayValue,
    editTarget: parentCell.editTarget ? { ...parentCell.editTarget, path } : undefined,
    key: `${parentCell.key}:path:${JSON.stringify(path)}`,
    title:
      entry.value === undefined ? 'undefined' : serializeProjectionCellValue(entry.value, true),
    value: entry.value,
  };
};
