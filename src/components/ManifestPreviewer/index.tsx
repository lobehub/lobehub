import { Highlighter } from '@lobehub/ui';
import { Popover } from 'antd';
import { type ReactNode, memo } from 'react';

interface PluginManifestPreviewerProps {
  children?: ReactNode;
  manifest: object;
  trigger?: 'click' | 'hover';
}

const ManifestPreviewer = memo<PluginManifestPreviewerProps>(
  ({ manifest, children, trigger = 'click' }) => (
    <Popover
      arrow={false}
      content={
        <Highlighter
          language={'json'}
          style={{ maxHeight: 600, maxWidth: 400, overflow: 'scroll' }}
        >
          {JSON.stringify(manifest, null, 2)}
        </Highlighter>
      }
      placement={'right'}
      style={{ width: 400 }}
      title={'Manifest JSON'}
      trigger={trigger}
    >
      {children}
    </Popover>
  ),
);

export default ManifestPreviewer;
