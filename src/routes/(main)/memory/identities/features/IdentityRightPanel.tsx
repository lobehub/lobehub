'use client';

import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';

import IdentityDetail from './IdentityDetail';
import IdentityDropdown from './IdentityDropdown';

const IdentityRightPanel = memo(() => {
  const [identityId] = useQueryState('identityId', { clearOnDefault: true });

  if (!identityId) return null;

  return (
    <DetailPanel
      header={{
        right: <IdentityDropdown id={identityId} size={DESKTOP_HEADER_ICON_SIZE} />,
      }}
    >
      <IdentityDetail id={identityId} />
    </DetailPanel>
  );
});

export default IdentityRightPanel;
