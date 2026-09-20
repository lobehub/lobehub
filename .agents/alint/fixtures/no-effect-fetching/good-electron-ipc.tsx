// Fixture: a local Electron IPC read is not a remote fetch.
import { memo, useEffect, useState } from 'react';

import { isDesktop } from '@/const/version';
import { autoUpdateService } from '@/services/electron/autoUpdate';

const UpdateChannel = memo(() => {
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable');

  useEffect(() => {
    if (!isDesktop) return;
    autoUpdateService
      .getUpdateChannel()
      .then(setChannel)
      .catch(() => {});
  }, []);

  return <span>{channel}</span>;
});

export default UpdateChannel;
