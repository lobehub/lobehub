import type { EditLocalFileState } from '@lobechat/builtin-tool-local-system';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Flexbox, PatchDiff, Skeleton } from '@lobehub/ui';
import React, { memo } from 'react';

const EditLocalFile = memo<BuiltinRenderProps<any, EditLocalFileState>>(
  ({ args, pluginState, pluginError }) => {
    if (!args) return <Skeleton active />;

    // Support both IPC format (file_path) and ComputerRuntime format (path)
    const filePath = args.file_path || args.path || '';

    return (
      <Flexbox gap={12}>
        {pluginError ? (
          <Alert
            showIcon
            description={pluginError.message || 'Unknown error occurred'}
            title="Edit Failed"
            type="error"
          />
        ) : pluginState?.diffText ? (
          <PatchDiff
            fileName={filePath}
            patch={pluginState.diffText}
            showHeader={false}
            variant="borderless"
            viewMode="unified"
          />
        ) : null}
      </Flexbox>
    );
  },
);

EditLocalFile.displayName = 'EditLocalFile';

export default EditLocalFile;
