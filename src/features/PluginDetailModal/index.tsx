import { createModal } from '@lobehub/ui';
import { t as i18nT } from 'i18next';
import { memo } from 'react';

import APIs from './APIs';
import Meta from './Meta';

export interface PluginDetailModalProps {
  id: string;
}

const PluginDetailModal = memo<PluginDetailModalProps>(({ id }) => {
  return (
    <>
      <Meta id={id} />
      <APIs id={id} />
    </>
  );
});

PluginDetailModal.displayName = 'PluginDetailModal';

export const createPluginDetailModal = (props: PluginDetailModalProps) =>
  createModal({
    content: <PluginDetailModal {...props} />,
    footer: null,
    title: i18nT('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });
