'use client';

import { memo } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';
import { useHeaderActionSize } from '@/styles/density';

import IdentityDetail from './IdentityDetail';
import IdentityDropdown from './IdentityDropdown';

const IdentityRightPanel = memo(() => {
  const [identityId] = useQueryState('identityId', { clearOnDefault: true });
  const headerActionSize = useHeaderActionSize();

  if (!identityId) return null;

  return (
    <DetailPanel
      header={{
        right: <IdentityDropdown id={identityId} size={headerActionSize} />,
      }}
    >
      <IdentityDetail id={identityId} />
    </DetailPanel>
  );
});

export default IdentityRightPanel;
