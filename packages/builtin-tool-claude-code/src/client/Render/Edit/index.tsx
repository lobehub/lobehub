'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { CodeDiff, Flexbox, Skeleton } from '@lobehub/ui';
import path from 'path-browserify-esm';
import { memo } from 'react';

interface EditArgs {
  file_path?: string;
  new_string?: string;
  old_string?: string;
  replace_all?: boolean;
}

const Edit = memo<BuiltinRenderProps<EditArgs>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const filePath = args.file_path || '';
  const fileName = filePath ? path.basename(filePath) : '';
  const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : '';

  return (
    <Flexbox gap={12}>
      <CodeDiff
        fileName={fileName || filePath}
        language={ext || undefined}
        newContent={args.new_string ?? ''}
        oldContent={args.old_string ?? ''}
        showHeader={!!fileName}
        variant={'borderless'}
        viewMode={'unified'}
      />
    </Flexbox>
  );
});

Edit.displayName = 'ClaudeCodeEdit';

export default Edit;
