import { Button, Center, Icon, Text } from '@lobehub/ui';
import { Minimize2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import BoardView from '../Board';
import { ArtboardFullscreen } from '../Board/Fullscreen';
import { artboardActions, useArtboardStore } from '../store';
import { useArtboardFeature } from '../useArtboardFeature';

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

const BoardPane = ({ artboardId }: { artboardId: string }) => {
  const { enabled } = useArtboardFeature();
  const fullscreen = useArtboardStore((s) => s.fullscreen && s.boardId === artboardId);
  if (!enabled) return null;
  if (fullscreen) return <FullscreenPlaceholder artboardId={artboardId} />;
  return <BoardView artboardId={artboardId} />;
};

export default BoardPane;
