'use client';

import { Flexbox } from '@lobehub/ui';
import { Checkbox, Input, Select, Table } from 'antd';
import { cssVar } from 'antd-style';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type DatasetPreset } from '../../config/datasetPresets';
import { ROLE_COLORS } from './const';

// Known candidate names for auto-inference
const INPUT_CANDIDATES = new Set([
  'input',
  'question',
  'prompt',
  'query',
  'text',
  'instruction',
  'problem',
]);
const EXPECTED_CANDIDATES = new Set([
  'expected',
  'answer',
  'ideal',
  'target',
  'output',
  'response',
  'label',
  'ground_truth',
  'groundtruth',
]);
const CATEGORY_CANDIDATES = new Set(['category', 'topic', 'type', 'subject', 'class', 'tag']);
const CHOICES_CANDIDATES = new Set(['choices', 'options', 'alternatives', 'candidates']);

type MappingTarget =
  | 'choices'
  | 'category'
  | 'expected'
  | 'ignore'
  | 'input'
  | 'metadata'
  | 'sortOrder';

export interface FieldMappingValue {
  category?: string;
  choices?: string;
  expected?: string;
  expectedDelimiter?: string;
  input: string;
  metadata?: Record<string, string>;
  sortOrder?: string;
}

interface MappingStepProps {
  delimiter: string;
  headers: string[];
  mapping: Record<string, MappingTarget>;
  onDelimiterChange: (delimiter: string) => void;
  onMappingChange: (mapping: Record<string, MappingTarget>) => void;
  preview: Record<string, any>[];
  totalCount: number;
}

const SORT_ORDER_CANDIDATES = new Set(['id', 'number', 'index', 'no', 'order', 'sort_order']);

const autoInferMapping = (
  headers: string[],
  preset?: DatasetPreset,
): Record<string, MappingTarget> => {
  const result: Record<string, MappingTarget> = {};
  let inputFound = false;
  let expectedFound = false;
  let categoryFound = false;
  let choicesFound = false;
  let sortOrderFound = false;

  // Use preset's fieldInference if available, otherwise use default candidates
  const inputCandidates = preset
    ? new Set(preset.fieldInference.input.map((s) => s.toLowerCase()))
    : INPUT_CANDIDATES;
  const expectedCandidates = preset
    ? new Set(preset.fieldInference.expected.map((s) => s.toLowerCase()))
    : EXPECTED_CANDIDATES;
  const choicesCandidates = preset
    ? new Set(preset.fieldInference.choices.map((s) => s.toLowerCase()))
    : CHOICES_CANDIDATES;
  const categoryCandidates = preset
    ? new Set(preset.fieldInference.category.map((s) => s.toLowerCase()))
    : CATEGORY_CANDIDATES;
  const sortOrderCandidates = preset?.fieldInference.sortOrder
    ? new Set(preset.fieldInference.sortOrder.map((s) => s.toLowerCase()))
    : SORT_ORDER_CANDIDATES;

  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (!inputFound && inputCandidates.has(lower)) {
      result[h] = 'input';
      inputFound = true;
    } else if (!expectedFound && expectedCandidates.has(lower)) {
      result[h] = 'expected';
      expectedFound = true;
    } else if (!choicesFound && choicesCandidates.has(lower)) {
      result[h] = 'choices';
      choicesFound = true;
    } else if (!categoryFound && categoryCandidates.has(lower)) {
      result[h] = 'category';
      categoryFound = true;
    } else if (!sortOrderFound && sortOrderCandidates.has(lower)) {
      result[h] = 'sortOrder';
      sortOrderFound = true;
    } else {
      result[h] = 'ignore';
    }
  }

  // Fallback: if no input matched, use first column
  if (!inputFound && headers.length > 0) {
    result[headers[0]] = 'input';
  }

  return result;
};

export { autoInferMapping };

const COL_WIDTHS: Record<MappingTarget, number> = {
  category: 160,
  choices: 200,
  expected: 300,
  ignore: 100,
  input: 800,
  metadata: 160,
  sortOrder: 120,
};

const WRAP_ROLES = new Set<MappingTarget>(['input', 'expected']);

const MappingStep = memo<MappingStepProps>(
  ({ headers, mapping, onMappingChange, preview, delimiter, onDelimiterChange, totalCount }) => {
    const { t } = useTranslation('eval');
    const [hideSkipped, setHideSkipped] = useState(true);

    const hasChoices = Object.values(mapping).includes('choices');
    const hasIgnored = Object.values(mapping).includes('ignore');

    const visibleHeaders = useMemo(
      () => (hideSkipped ? headers.filter((h) => mapping[h] !== 'ignore') : headers),
      [headers, mapping, hideSkipped],
    );

    const roleDescColor = (role: MappingTarget) => ROLE_COLORS[role] || cssVar.colorTextTertiary;

    const targetOptions: { label: ReactNode; value: MappingTarget }[] = [
      { desc: 'inputDesc', label: 'input', value: 'input' },
      { desc: 'expectedDesc', label: 'expected', value: 'expected' },
      { desc: 'choicesDesc', label: 'choices', value: 'choices' },
      { desc: 'categoryDesc', label: 'category', value: 'category' },
      { desc: 'sortOrderDesc', label: 'sortOrder', value: 'sortOrder' },
      { desc: 'metadataDesc', label: 'metadata', value: 'metadata' },
      { desc: 'ignoreDesc', label: 'ignore', value: 'ignore' },
    ].map(({ desc, label, value }) => ({
      label: (
        <Flexbox gap={2}>
          <span style={{ fontSize: 11 }}>{t(`dataset.import.${label}` as any)}</span>
          <span style={{ color: roleDescColor(value as MappingTarget), fontSize: 11 }}>
            {t(`dataset.import.${desc}` as any)}
          </span>
        </Flexbox>
      ),
      value: value as MappingTarget,
    }));

    const handleRoleChange = (h: string, val: MappingTarget) => {
      const newMapping = { ...mapping };

      // Ensure single assignment for input/expected/context/sortOrder
      if (val !== 'metadata' && val !== 'ignore') {
        for (const [k, v] of Object.entries(newMapping)) {
          if (v === val) newMapping[k] = 'ignore';
        }
      }

      newMapping[h] = val;
      onMappingChange(newMapping);
    };

    const columns = useMemo(
      () =>
        visibleHeaders.map((h) => {
          const role = mapping[h];
          const isIgnored = role === 'ignore';
          const allowWrap = WRAP_ROLES.has(role);
          const color = ROLE_COLORS[role];

          return {
            dataIndex: h,
            ellipsis: !allowWrap,
            onCell: isIgnored
              ? () => ({ style: { color: cssVar.colorTextQuaternary } })
              : allowWrap
                ? () => ({
                    style: {
                      verticalAlign: 'top',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word' as const,
                    },
                  })
                : undefined,
            title: (
              <Flexbox gap={2}>
                <span style={{ fontSize: 13, opacity: isIgnored ? 0.4 : 1 }}>{h}</span>
                <Select
                  options={targetOptions}
                  popupMatchSelectWidth={200}
                  size="small"
                  value={role}
                  variant="borderless"
                  style={{
                    color:
                      color || (isIgnored ? cssVar.colorTextQuaternary : cssVar.colorTextTertiary),
                    fontSize: 11,
                    marginInlineStart: -7,
                  }}
                  onChange={(val: MappingTarget) => handleRoleChange(h, val)}
                />
              </Flexbox>
            ),
            width: COL_WIDTHS[role],
          };
        }),
      [visibleHeaders, mapping],
    );

    const scrollX = useMemo(
      () => visibleHeaders.reduce((sum, h) => sum + COL_WIDTHS[mapping[h]], 0),
      [visibleHeaders, mapping],
    );

    return (
      <Flexbox gap={12}>
        {/* Toolbar */}
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal align="center" gap={16}>
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 13 }}>
              {t('dataset.import.fieldMapping.desc')}
            </span>
            <span style={{ color: cssVar.colorTextQuaternary, fontSize: 12 }}>
              {t('dataset.import.preview.rows', { count: totalCount })}
            </span>
          </Flexbox>
          <Flexbox horizontal align="center" gap={16}>
            {hasChoices && (
              <Flexbox horizontal align="center" gap={8}>
                <span
                  style={{ color: cssVar.colorTextSecondary, fontSize: 12, whiteSpace: 'nowrap' }}
                >
                  {t('dataset.import.expectedDelimiter.desc')}
                </span>
                <Input
                  placeholder={t('dataset.import.expectedDelimiter.placeholder')}
                  size="small"
                  style={{ width: 120 }}
                  value={delimiter}
                  onChange={(e) => onDelimiterChange(e.target.value)}
                />
              </Flexbox>
            )}
            {hasIgnored && (
              <Checkbox checked={hideSkipped} onChange={(e) => setHideSkipped(e.target.checked)}>
                <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                  {t('dataset.import.hideSkipped')}
                </span>
              </Checkbox>
            )}
          </Flexbox>
        </Flexbox>

        {/* Data preview table */}
        <Table
          bordered
          columns={columns}
          dataSource={preview.map((row, i) => ({ ...row, _key: i }))}
          pagination={false}
          rowKey="_key"
          scroll={{ x: scrollX, y: 'calc(95vh - 280px)' }}
          size="small"
        />
      </Flexbox>
    );
  },
);

export default MappingStep;
