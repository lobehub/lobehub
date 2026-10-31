import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CopyIcon, ExternalLinkIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { DockTask } from './type';

const styles = stylex.create({
  action: {
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: 'opacity 0.2s ease',
  },
  progress: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: 0,
    insetInlineStart: 0,
    height: '2px',
    backgroundColor: cssVar.geekblue,
    backgroundImage: 'none',
    transition: 'inset-inline-end 0.2s linear',
  },
  result: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorFillQuaternary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  resultLabel: {
    minWidth: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: `${cssVar.fontSizeSM}px`,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    fontSize: '14px',
    lineHeight: 1.4,
    textOverflow: 'ellipsis',
  },
});

interface ItemProps extends DockTask {
  /** A solo card has no group gutter, so its result strip is flush left. */
  solo?: boolean;
}

const Item = memo<ItemProps>(
  ({ cancel, detail, dismiss, extra, icon, progress, result, retry, solo, status, title }) => {
    const { t } = useTranslation('common');
    // A finished task is the user's to clear. The panel puts that on its
    // header; a solo card has no header, so the row carries it.
    const closable = dismiss && status !== 'running' && status !== 'pending';

    return (
      <Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(stylex.defaultMarker()).className}
          gap={12}
          paddingBlock={8}
          paddingInline={12}
          style={{ position: 'relative' }}
        >
          {icon}
          <Flexbox flex={1} gap={2} style={{ overflow: 'hidden' }}>
            <div className={stylex.props(styles.title).className}>{title}</div>
            {detail}
            {extra}
          </Flexbox>

          {cancel && (
            <ActionIcon
              className={stylex.props(styles.action).className}
              icon={XIcon}
              size="small"
              title={t('cancel')}
              onClick={cancel}
            />
          )}

          {retry && (
            <ActionIcon icon={RotateCwIcon} size="small" title={t('retry')} onClick={retry} />
          )}

          {closable && (
            <ActionIcon icon={XIcon} size="small" title={t('close')} onClick={dismiss} />
          )}

          {status === 'running' && progress !== undefined && (
            <div {...sx([styles.progress], undefined, { insetInlineEnd: `${100 - progress}%` })} />
          )}
        </Flexbox>

        {result && (
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.result).className}
            gap={8}
            paddingBlock={6}
            style={{ paddingInlineEnd: 8, paddingInlineStart: solo ? 12 : 48 }}
          >
            <Text
              ellipsis
              className={stylex.props(styles.resultLabel).className}
              type={result.onOpen ? undefined : 'secondary'}
            >
              {result.label}
            </Text>
            {result.onCopy && (
              <ActionIcon icon={CopyIcon} size="small" title={t('copy')} onClick={result.onCopy} />
            )}
            {result.onOpen && (
              <ActionIcon
                icon={ExternalLinkIcon}
                size="small"
                title={t('taskDock.open')}
                onClick={result.onOpen}
              />
            )}
            {result.action && (
              <Button size={'small'} onClick={result.onAction}>
                {result.action}
              </Button>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

Item.displayName = 'TaskDockItem';

export default Item;
