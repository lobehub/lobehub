import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useArtboard } from '../data/useArtboard';

const BoardTabLabel = memo<{ artboardId: string }>(({ artboardId }) => {
  const { t } = useTranslation('project');
  const { data } = useArtboard(artboardId);

  return data?.artboard.title || t('artboard.header.title');
});

BoardTabLabel.displayName = 'ArtboardTabLabel';

export default BoardTabLabel;
