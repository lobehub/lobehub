'use client';

import { memo } from 'react';

import { useDetailContext } from '../../DetailProvider';
import Platform from '../../Sidebar/Platform';

const Installation = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { identifier, downloadUrl } = useDetailContext();

  return (
    <Platform
      expandCodeByDefault
      downloadUrl={downloadUrl}
      identifier={identifier}
      mobile={mobile}
    />
  );
});

export default Installation;
