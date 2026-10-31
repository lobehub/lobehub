'use client';

import type { AcceptanceFrameSource } from '@lobechat/types';
import { Icon, Tag, Tooltip } from '@lobehub/ui';
import { Camera, PenTool } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Provenance on every image of the board. The word is always written out —
 * MOCK or REAL — so it never depends on colour or on which side of the
 * comparison the picture sits.
 */
const SourceBadge = ({ source }: { source: AcceptanceFrameSource }) => {
  const { t } = useTranslation('verify');
  const mock = source === 'mock';
  return (
    <Tooltip title={t(mock ? 'frames.legend.mock' : 'frames.legend.real')}>
      <Tag
        color={mock ? 'purple' : 'green'}
        icon={<Icon icon={mock ? PenTool : Camera} size={11} />}
        size={'small'}
        style={{ fontWeight: 600, letterSpacing: 0.4 }}
        variant={mock ? 'outlined' : 'solid'}
      >
        {t(mock ? 'frames.source.mock' : 'frames.source.real')}
      </Tag>
    </Tooltip>
  );
};

export default SourceBadge;
