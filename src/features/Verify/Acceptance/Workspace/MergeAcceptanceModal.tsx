'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { Search } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import type { AcceptanceListItem } from '@/services/verify';

import { useAcceptanceList } from '../../hooks';
import { frostedModalStyles } from '../modals';

/** A settled aggregate cannot receive checks — the server refuses it too. */
const SETTLED_STATUSES = new Set(['accepted', 'closed']);

const styles = createStaticStyles(({ css }) => ({
  search: css`
    display: flex;
    gap: 7px;
    align-items: center;

    height: 32px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    svg {
      flex: none;
      color: ${cssVar.colorTextQuaternary};
    }

    input {
      width: 100%;
      min-width: 0;
      border: none;

      font-size: 13px;
      color: ${cssVar.colorText};

      background: none;
      outline: none;
    }
  `,
  list: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;

    min-height: 120px;
    max-height: 320px;
    padding-block: 4px;
  `,
  option: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;

    padding-block: 7px;
    padding-inline: 10px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionActive: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.45;

    &:hover {
      background: none;
    }
  `,
  optionTitle: css`
    overflow: hidden;
    display: block;

    width: 100%;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  optionSub: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  empty: css`
    padding-block: 28px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
}));

const titleOf = (item: AcceptanceListItem) => item.subject.title || item.subjectId;

interface MergeContentProps {
  /** Perform the merge; resolve true to close the dialog. */
  onConfirm: (targetId: string) => Promise<boolean>;
  /** The acceptance being folded away. */
  source: AcceptanceListItem;
}

const MergeContent = memo<MergeContentProps>(({ onConfirm, source }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const { data, isLoading } = useAcceptanceList(true);
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const keyword = query.trim().toLowerCase();
  const candidates = (data ?? [])
    .filter((item) => item.id !== source.id)
    .filter((item) => !keyword || titleOf(item).toLowerCase().includes(keyword));

  const handleConfirm = async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      if (await onConfirm(targetId)) close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type={'secondary'}>
        {translate('acceptance.workspace.merge.description', {
          count: source.checkCount ?? 0,
          title: titleOf(source),
        })}
      </Text>

      <label className={styles.search}>
        <Icon icon={Search} size={13} />
        <input
          autoFocus
          placeholder={translate('acceptance.workspace.merge.searchPlaceholder')}
          type={'search'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : candidates.length === 0 ? (
        <div className={styles.empty}>{translate('acceptance.workspace.merge.noCandidates')}</div>
      ) : (
        <div className={styles.list}>
          {candidates.map((item) => {
            const settled = SETTLED_STATUSES.has(item.status);
            return (
              <button
                disabled={settled}
                key={item.id}
                type={'button'}
                className={[
                  styles.option,
                  item.id === targetId ? styles.optionActive : '',
                  settled ? styles.optionDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setTargetId(item.id)}
              >
                <span className={styles.optionTitle}>{titleOf(item)}</span>
                <span className={styles.optionSub}>
                  {item.checkCount == null
                    ? translate(`acceptance.status.${item.status}` as any)
                    : translate('acceptance.workspace.checkCount', { count: item.checkCount })}
                  {settled ? ` · ${translate('acceptance.workspace.merge.settledHint')}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Text fontSize={12} type={'secondary'}>
        {translate('acceptance.workspace.merge.hint')}
      </Text>

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {translate('acceptance.actions.cancel')}
        </Button>
        <Button disabled={!targetId} loading={loading} type={'primary'} onClick={handleConfirm}>
          {translate('acceptance.workspace.merge.confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

MergeContent.displayName = 'AcceptanceMergeContent';

/**
 * Target picker for folding one acceptance into another. The source's checks
 * move; the source entry goes away — so the dialog names both sides and what
 * carries over before the click, and never pre-selects a target.
 */
export const openMergeAcceptanceModal = (options: MergeContentProps): ModalInstance =>
  createModal({
    content: <MergeContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title: t('acceptance.workspace.merge.title', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });
