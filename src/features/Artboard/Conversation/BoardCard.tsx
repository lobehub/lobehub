import {
  ArtboardApiName,
  type ArtboardToolState,
  type CreateArtboardParams,
} from '@lobechat/builtin-tool-artboard';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { PresentationIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useArtboardFeature } from '../useArtboardFeature';
import { openBoardPanel } from './openBoardPanel';

type BoardCardProps = BuiltinRenderProps<Partial<CreateArtboardParams>, ArtboardToolState>;

const BoardCard = ({ apiName, args, messageId, pluginError, pluginState }: BoardCardProps) => {
  const { t } = useTranslation('project');
  const { enabled } = useArtboardFeature();
  if (!enabled || pluginError || !pluginState?.artboardId) return null;

  const updated = apiName === ArtboardApiName.updateArtboard;
  const open = () => openBoardPanel(messageId);

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={12}
      paddingBlock={10}
      paddingInline={12}
      variant={'outlined'}
      onClick={open}
    >
      <Icon icon={PresentationIcon} size={20} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {updated
            ? t('artboard.card.updated', { revision: pluginState.revision })
            : t('artboard.title')}
        </Text>
        <Text ellipsis strong>
          {pluginState.title || args?.title}
        </Text>
        <Text ellipsis style={{ fontSize: 12 }} type={'secondary'}>
          {t('artboard.card.summary', {
            frames: pluginState.frameCount,
            groups: pluginState.groupCount,
          })}
        </Text>
      </Flexbox>
      <Button
        size={'small'}
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
