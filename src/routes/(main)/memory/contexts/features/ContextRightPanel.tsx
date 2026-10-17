'use client';

import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';

import ContextDetail from './ContextDetail';
import ContextDropdown from './ContextDropdown';

const ContextRightPanel = memo(() => {
  const [contextId] = useQueryState('contextId', { clearOnDefault: true });

  if (!contextId) return null;

  return (
    <DetailPanel
      header={{
        right: <ContextDropdown id={contextId} size={DESKTOP_HEADER_ICON_SIZE} />,
      }}
    >
      <ContextDetail id={contextId} />
    </DetailPanel>
  );
});

export default ContextRightPanel;
