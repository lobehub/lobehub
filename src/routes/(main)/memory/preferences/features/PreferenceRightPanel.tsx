'use client';

import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';

import PreferenceDetail from './PreferenceDetail';
import PreferenceDropdown from './PreferenceDropdown';

const PreferenceRightPanel = memo(() => {
  const [preferenceId] = useQueryState('preferenceId', { clearOnDefault: true });

  if (!preferenceId) return null;

  return (
    <DetailPanel
      header={{
        right: <PreferenceDropdown id={preferenceId} size={DESKTOP_HEADER_ICON_SIZE} />,
      }}
    >
      <PreferenceDetail id={preferenceId} />
    </DetailPanel>
  );
});

export default PreferenceRightPanel;
