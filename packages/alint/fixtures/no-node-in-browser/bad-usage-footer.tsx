// Fixture: a client component reading a CLI session log straight from disk.
// alint-expect
import { readFile } from 'node:fs/promises';

import { memo, useEffect, useState } from 'react';

export const UsageFooter = memo<{ logPath: string }>(({ logPath }) => {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    readFile(logPath, 'utf8').then((content) => setTotal(content.split('\n').length));
  }, [logPath]);
  return <span>{total} requests</span>;
});
