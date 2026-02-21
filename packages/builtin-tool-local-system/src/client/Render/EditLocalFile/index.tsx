import type { EditLocalFileState } from '@lobechat/builtin-tool-local-system';
import type { EditLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Flexbox, PatchDiff, Skeleton } from '@lobehub/ui';
import React, { memo } from 'react';

const EditLocalFile = memo<BuiltinRenderProps<EditLocalFileParams, EditLocalFileState>>(
  ({ args, pluginState, pluginError }) => {
    if (!args) return <Skeleton active />;

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
            fileName={args.file_path}
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
