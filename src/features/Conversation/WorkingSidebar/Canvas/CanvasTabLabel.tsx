import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCanvasTabView, useCanvasVersion } from './useCanvasVersion';

const CanvasTabLabel = memo<{ canvasId: string }>(({ canvasId }) => {
  const { t } = useTranslation('portal');
  const { data } = useCanvasVersion(useCanvasTabView(canvasId));

  return data?.title || t('canvas.title');
});

CanvasTabLabel.displayName = 'WorkingSidebarCanvasTabLabel';

export default CanvasTabLabel;
