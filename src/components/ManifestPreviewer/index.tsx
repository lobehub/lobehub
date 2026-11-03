import { Highlighter, Popover } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

interface PluginManifestPreviewerProps {
  children?: ReactNode;
  manifest: object;
  trigger?: 'click' | 'hover';
}

const ManifestPreviewer = memo<PluginManifestPreviewerProps>(
  ({ manifest, children, trigger = 'click' }) => (
    <Popover
      placement={'right'}
      styles={{ content: { width: 400 } }}
      trigger={trigger}
      content={
        <Highlighter
          language={'json'}
          style={{ maxHeight: 600, maxWidth: 400, overflow: 'scroll' }}
        >
          {JSON.stringify(manifest, null, 2)}
        </Highlighter>
      }
    >
      {children}
    </Popover>
  ),
);

export default ManifestPreviewer;
