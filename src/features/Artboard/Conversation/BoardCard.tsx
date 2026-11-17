import {
  ArtboardApiName,
  type ArtboardToolState,
  type CreateArtboardParams,
} from '@lobechat/builtin-tool-artboard';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Button, Center, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PresentationIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useArtboardFeature } from '../useArtboardFeature';
import { openBoardPanel } from './openBoardPanel';

const styles = stylex.create({
  card: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
  },
  tile: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 8,
    color: cssVar.colorTextSecondary,
    flex: 'none',
    height: 36,
    width: 36,
  },
  eyebrow: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
  title: {
    color: cssVar.colorText,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  open: {
    borderRadius: 999,
    flex: 'none',
  },
});

type BoardCardProps = BuiltinRenderProps<Partial<CreateArtboardParams>, ArtboardToolState>;

const BoardCard = ({ apiName, args, pluginError, pluginState }: BoardCardProps) => {
  const { t } = useTranslation('project');
  const { enabled } = useArtboardFeature();
  const artboardId = pluginState?.artboardId;
  if (!enabled || pluginError || !artboardId) return null;

  const updated = apiName === ArtboardApiName.updateArtboard;
  const open = () => openBoardPanel(artboardId);

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={12}
      paddingBlock={10}
      paddingInline={12}
      variant={'outlined'}
      {...stylex.props(styles.card)}
      onClick={open}
    >
      <Center {...stylex.props(styles.tile)}>
        <Icon icon={PresentationIcon} size={{ size: 18, strokeWidth: 1.75 }} />
      </Center>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <span {...stylex.props(styles.eyebrow)}>
          {updated
            ? t('artboard.card.updated', { revision: pluginState.revision })
            : t('artboard.title')}
        </span>
        <span {...stylex.props(styles.title)}>{pluginState.title || args?.title}</span>
        <span {...stylex.props(styles.meta)}>
          {t('artboard.card.summary', {
            boards: pluginState.boardCount,
            groups: pluginState.groupCount,
          })}
        </span>
      </Flexbox>
      <Button
        size={'small'}
        {...stylex.props(styles.open)}
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      >
        {t('artboard.card.openBoard')}
      </Button>
    </Block>
  );
};

export default BoardCard;
