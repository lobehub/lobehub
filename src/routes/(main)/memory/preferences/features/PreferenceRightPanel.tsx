'use client';

import { memo } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';
import { useHeaderActionSize } from '@/styles/density';

import PreferenceDetail from './PreferenceDetail';
import PreferenceDropdown from './PreferenceDropdown';

const PreferenceRightPanel = memo(() => {
  const [preferenceId] = useQueryState('preferenceId', { clearOnDefault: true });
  const headerActionSize = useHeaderActionSize();

  if (!preferenceId) return null;

  return (
    <DetailPanel
      header={{
        right: <PreferenceDropdown id={preferenceId} size={headerActionSize} />,
      }}
    >
      <PreferenceDetail id={preferenceId} />
    </DetailPanel>
  );
});

export default PreferenceRightPanel;
