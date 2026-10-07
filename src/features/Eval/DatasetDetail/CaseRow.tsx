'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Tag } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Check, Ellipsis, Minus, Pencil, Repeat, Trash2, Type } from 'lucide-react';
import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { stripSpeakerTags } from '@/features/Eval/components/inputPreview';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import SourceTopicLink from './SourceTopicLink';
import { styles } from './style';

export interface DatasetCase {
  content?: { expected?: string | null; input?: string | null } | null;
  evalConfig?: { criteria?: unknown } | null;
  hasFrozenCall?: boolean;
  id: string;
  sourceTopicId?: string | null;
}

interface CaseRowProps {
  index: number;
  onDelete: (testCase: DatasetCase) => void;
  onEdit: (testCase: DatasetCase) => void;
  testCase: DatasetCase;
}

export const hasCriteria = (testCase: DatasetCase) =>
  typeof testCase.evalConfig?.criteria === 'string' && testCase.evalConfig.criteria.trim() !== '';

const CaseRow = ({ index, onDelete, onEdit, testCase }: CaseRowProps) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const open = () => navigate(`/eval/cases/${testCase.id}`);
  const input = stripSpeakerTags(testCase.content?.input ?? '');
  const criteria = hasCriteria(testCase);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  return (
    <Flexbox
      horizontal
      align="flex-start"
      className={styles.caseRow}
      data-testid="dataset-case-row"
      gap={12}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.caseIndex}>{index}</span>
      <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
        <div className={styles.caseInput}>
          {input || <span className={styles.muted}>{t('dataset.case.noInput')}</span>}
        </div>
        <Flexbox horizontal align="center" gap={12} wrap="wrap">
          {testCase.hasFrozenCall ? (
            <Tag color="success" icon={<Repeat size={12} />} size="small">
              {t('dataset.case.frozen')}
            </Tag>
          ) : (
            <Tag icon={<Type size={12} />} size="small">
              {t('dataset.case.textOnly')}
            </Tag>
          )}
          <span
            className={styles.chip}
            style={criteria ? { color: cssVar.colorTextSecondary } : undefined}
          >
            {criteria ? <Check size={12} /> : <Minus size={12} />}
            {criteria ? t('dataset.case.criteria') : t('dataset.case.noCriteria')}
          </span>
          {testCase.sourceTopicId && <SourceTopicLink topicId={testCase.sourceTopicId} />}
        </Flexbox>
      </Flexbox>
      <div
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu
          items={[
            {
              icon: <Pencil size={14} />,
              key: 'edit',
              label: t('common.edit'),
              onClick: () => onEdit(testCase),
            },
            { type: 'divider' },
            {
              danger: true,
              icon: <Trash2 size={14} />,
              key: 'delete',
              label: t('common.delete'),
              onClick: () => onDelete(testCase),
            },
          ]}
        >
          <ActionIcon icon={Ellipsis} size="small" title={t('dataset.case.actions')} />
        </DropdownMenu>
      </div>
    </Flexbox>
  );
};

export default CaseRow;
