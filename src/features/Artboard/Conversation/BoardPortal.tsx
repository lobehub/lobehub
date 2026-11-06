import type { BuiltinPortalProps } from '@lobechat/types';
import { Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Minimize2Icon, PresentationIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import BoardView from '../Board';
import { ArtboardFullscreen } from '../Board/Fullscreen';
import { artboardActions, useArtboardStore } from '../store';

interface BoardPortalState {
  artboardId?: string;
}

const exitFullscreen = () => artboardActions.setFullscreen(false);

const FullscreenPlaceholder = ({ artboardId }: { artboardId: string }) => {
  const { t } = useTranslation('project');
  useEffect(() => exitFullscreen, []);
  return (
    <Center flex={1} gap={12}>
      <Text type="secondary">{t('artboard.fullscreen.placeholder')}</Text>
      <Button icon={<Icon icon={Minimize2Icon} />} onClick={exitFullscreen}>
        {t('artboard.header.exitFullscreen')}
      </Button>
      <ArtboardFullscreen artboardId={artboardId} onClose={exitFullscreen} />
    </Center>
  );
};

const BoardPortal = ({ state }: BuiltinPortalProps<unknown, BoardPortalState>) => {
  const artboardId = state?.artboardId;
  const fullscreen = useArtboardStore((s) => s.fullscreen && s.boardId === artboardId);
  if (!artboardId) return null;
  if (fullscreen) return <FullscreenPlaceholder artboardId={artboardId} />;
  return (
    // The tool panel pads its body for reading; the board runs edge to edge.
    <Flexbox flex={1} height={'100%'} style={{ marginInline: -12, minHeight: 0 }}>
      <BoardView artboardId={artboardId} />
    </Flexbox>
  );
};

export const BoardPortalTitle = () => {
  const { t } = useTranslation('project');
  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Icon icon={PresentationIcon} size={18} />
      <Text ellipsis weight={500}>
        {t('artboard.header.title')}
      </Text>
    </Flexbox>
  );
};

export default BoardPortal;
