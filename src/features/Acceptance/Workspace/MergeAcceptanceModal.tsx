'use client';

import {
  Button,
  createModal,
  Empty,
  Flexbox,
  Icon,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { Search, TriangleAlert } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import type { AcceptanceListItem } from '@/services/verify';

import { useAcceptanceList } from '../hooks';
import { frostedModalStyles } from '../Viewer/Review/modals';

/** A settled aggregate cannot receive checks — the server refuses it too. */
const SETTLED_STATUSES = new Set(['accepted', 'closed']);

/**
 * How far back the picker reaches (the server caps the list read at 200).
 *
 * The sidebar's own feed stops at the newest 50, which is fine for a panel you
 * scroll — but a merge target that is not listed is a merge you cannot perform,
 * so this surface asks for the wide end. The list still has an end: when it is
 * reached, the footer says so instead of implying "this is everything".
 */
const TARGET_WINDOW = 200;

const styles = stylex.create({
  search: {
    display: 'flex',
    gap: '7px',
    alignItems: 'center',
    height: '32px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  searchIcon: { flex: 'none', color: cssVar.colorTextQuaternary },
  searchInput: {
    width: '100%',
    minWidth: '0',
    borderStyle: 'none',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outline: 'none',
  },
  list: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minHeight: '120px',
    maxHeight: '320px',
    paddingBlock: '4px',
  },
  option: {
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    alignItems: 'flex-start',
    paddingBlock: '7px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadius,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  optionActive: {
    borderColor: cssVar.colorPrimary,
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBg },
  },
  optionDisabled: {
    cursor: 'not-allowed',
    opacity: 0.45,
    backgroundColor: { 'default': 'transparent', ':hover': 'transparent' },
  },
  /* Disabled wins on hover, but an active row keeps its tint at rest. */
  optionActiveDisabled: {
    cursor: 'not-allowed',
    opacity: 0.45,
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': 'transparent' },
  },
  optionTitle: {
    overflow: 'hidden',
    display: 'block',
    width: '100%',
    fontSize: '13px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionSub: { fontSize: '12px', color: cssVar.colorTextTertiary },
  empty: {
    paddingBlock: '28px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '20px',
  },
  retryBtn: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorTextTertiary },
    borderRadius: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

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
  // Revalidate on open: the dialog is a decision surface, and the list's own
  // invalidations do not reach this wider window's cache key.
  const { data, error, isLoading, mutate } = useAcceptanceList(true, {
    limit: TARGET_WINDOW,
    revalidateOnMount: true,
  });
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const keyword = query.trim().toLowerCase();
  const others = (data ?? []).filter((item) => item.id !== source.id);
  const candidates = others.filter(
    (item) => !keyword || titleOf(item).toLowerCase().includes(keyword),
  );
  // The window has an end, and a target past it is unreachable from here — say
  // so rather than letting the list read as the complete set.
  const windowFull = (data?.length ?? 0) >= TARGET_WINDOW;

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

      <label {...stylex.props(styles.search)}>
        <Icon className={stylex.props(styles.searchIcon).className} icon={Search} size={13} />
        <input
          {...stylex.props(styles.searchInput)}
          autoFocus
          placeholder={translate('acceptance.workspace.merge.searchPlaceholder')}
          type={'search'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error ? (
        // A failed list read must not read as "there is nothing to merge into":
        // the two states lead to opposite conclusions about the delivery.
        <div {...stylex.props(styles.errorState)}>
          <Empty
            description={translate('workspace.loadError')}
            icon={TriangleAlert}
            title={translate('workspace.loadErrorTitle')}
          />
          <button {...stylex.props(styles.retryBtn)} type={'button'} onClick={() => void mutate()}>
            {translate('workspace.retry')}
          </button>
        </div>
      ) : isLoading ? (
        <SkeletonList rows={4} />
      ) : candidates.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          {translate(
            others.length === 0
              ? 'acceptance.workspace.merge.noCandidates'
              : 'acceptance.workspace.merge.noSearchResults',
            { query: query.trim() },
          )}
        </div>
      ) : (
        <div {...stylex.props(styles.list)}>
          {candidates.map((item) => {
            const settled = SETTLED_STATUSES.has(item.status);
            return (
              <button
                disabled={settled}
                key={item.id}
                type={'button'}
                {...stylex.props(
                  styles.option,
                  item.id === targetId && styles.optionActive,
                  settled &&
                    (item.id === targetId ? styles.optionActiveDisabled : styles.optionDisabled),
                )}
                onClick={() => setTargetId(item.id)}
              >
                <span {...stylex.props(styles.optionTitle)}>{titleOf(item)}</span>
                <span {...stylex.props(styles.optionSub)}>
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
        {windowFull
          ? ` ${translate('acceptance.workspace.merge.windowHint', { count: TARGET_WINDOW })}`
          : ''}
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
