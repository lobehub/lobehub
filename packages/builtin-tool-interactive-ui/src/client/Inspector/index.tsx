import type { BuiltinInspectorProps } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import type { RenderUIParams } from '../../types';

export const InteractiveUIInspector = ({
  args,
  partialArgs,
}: BuiltinInspectorProps<Partial<RenderUIParams>>) => {
  const { t } = useTranslation('plugin');
  const title = args?.title || partialArgs?.title;
  return (
    <span>
      {t('builtins.lobe-interactive-ui.apiName.renderUI')}
      {title ? ` · ${title.slice(0, 120)}` : ''}
    </span>
  );
};
