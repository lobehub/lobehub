import { ActionIcon, confirmModal, DropdownMenu, Icon, Tag, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo } from 'react';

import KindIcon from '../components/KindIcon';
import { useEntityDataContext } from '../context';
import { useEntityFormat } from '../format';
import { type MemoryEntity } from '../types';
import { useSelection } from '../useSelection';

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: '16px' },
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
    },
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: '13px',
    gap: '4px',
    marginInlineStart: '-2px',
    paddingBlock: 0,
    paddingInline: 0,
  },
  top: { alignItems: 'flex-start', display: 'flex', gap: '12px' },
  titles: { display: 'flex', flex: '1', flexDirection: 'column', gap: '4px', minWidth: 0 },
  eyebrow: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '8px',
  },
  title: { fontSize: '24px', fontWeight: 600, lineHeight: '32px', margin: 0 },
  tags: { color: cssVar.colorTextTertiary, fontSize: '12px' },
  summary: {
    color: cssVar.colorTextSecondary,
    fontSize: '14px',
    lineHeight: '22px',
    margin: 0,
  },
});

interface HeaderProps {
  entity: MemoryEntity;
}

const Header = memo<HeaderProps>(({ entity }) => {
  const { entities, remove, setStatus } = useEntityDataContext();
  const { back, ensureSelected, history, select } = useSelection();
  const backId = history.at(-1);
  const backTo = entities.find((e) => e.id === backId);
  const format = useEntityFormat();
  const { t } = format;
  const statusLabel = format.status(entity.statusValue);
  // The free-text type is shown when it says more than the kind it was folded into.
  const typeNote =
    entity.rawType && entity.rawType.toLowerCase() !== entity.kind ? entity.rawType : undefined;

  const handleStatus = async (value: string) => {
    ensureSelected(entity.id);
    try {
      await setStatus(entity.id, value);
    } catch {
      toast.error({ title: t('entity.header.statusFailed') });
    }
  };

  // The backend deletes for good, so this one asks first.
  const handleDelete = () =>
    confirmModal({
      cancelText: t('entity.delete.cancel'),
      content: t('entity.delete.content'),
      okButtonProps: { danger: true },
      okText: t('entity.delete.ok'),
      onOk: async () => {
        try {
          await remove(entity.id);
          select(entities.find((e) => e.id !== entity.id && e.status === 'active')?.id);
          toast.success({ title: t('entity.delete.success', { title: format.title(entity) }) });
        } catch {
          toast.error({ title: t('entity.delete.failed') });
        }
      },
      title: t('entity.delete.title', { title: format.title(entity) }),
    });

  return (
    <header {...stylex.props(styles.root)}>
      {backTo && (
        <button type={'button'} {...stylex.props(styles.back)} onClick={back}>
          <Icon icon={ArrowLeftIcon} size={14} />
          {t('entity.header.back', { title: format.title(backTo) })}
        </button>
      )}
      <div {...stylex.props(styles.top)}>
        <KindIcon kind={entity.kind} size={'lg'} />
        <div {...stylex.props(styles.titles)}>
          <div {...stylex.props(styles.eyebrow)}>
            <span>
              {format.kind(entity.kind)}
              {typeNote && ` · ${typeNote}`}
            </span>
            {statusLabel && <Tag size={'small'}>{statusLabel}</Tag>}
          </div>
          <h2 {...stylex.props(styles.title)}>{format.title(entity)}</h2>
          {entity.tags.length > 0 && (
            <span {...stylex.props(styles.tags)}>
              {entity.tags.map((tag) => `#${tag}`).join('  ')}
            </span>
          )}
        </div>
        <DropdownMenu
          items={[
            entity.status === 'closed'
              ? {
                  icon: <Icon icon={RotateCcwIcon} />,
                  key: 'reopen',
                  label: t('entity.header.reopen'),
                  onClick: () => handleStatus('ongoing'),
                }
              : {
                  icon: <Icon icon={ArchiveIcon} />,
                  key: 'close',
                  label: t('entity.header.markDone'),
                  onClick: () => handleStatus('completed'),
                },
            { type: 'divider' },
            {
              danger: true,
              icon: <Icon icon={Trash2Icon} />,
              key: 'delete',
              label: t('entity.header.delete'),
              onClick: handleDelete,
            },
          ]}
        >
          <ActionIcon
            aria-label={t('entity.header.more')}
            icon={MoreHorizontalIcon}
            title={t('entity.header.more')}
          />
        </DropdownMenu>
      </div>
      {entity.summary && entity.summary !== entity.description && (
        <p {...stylex.props(styles.summary)}>{entity.summary}</p>
      )}
    </header>
  );
});

Header.displayName = 'EntityHeader';

export default Header;
