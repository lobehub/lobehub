import { type PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { memo } from 'react';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

import IFrameRender from './Iframe';

export interface PluginStandaloneTypeProps {
  id: string;
  name?: string;
  payload?: PluginRequestPayload;
}

const PluginDefaultType = memo<PluginStandaloneTypeProps>(({ payload, id, name = 'unknown' }) => {
  const manifest = useToolStore(pluginSelectors.getToolManifestById(name));

  if (!manifest?.ui) return;

  const ui = manifest.ui;

  if (!ui.url) return;
  // if the id start with "tmp", return directly to avoid duplicate rendering
  if (id.startsWith('tmp')) return;
  return (
    <IFrameRender
      height={ui.height}
      id={id}
      key={id}
      payload={payload}
      url={ui.url}
      width={ui.width}
    />
  );
});

export default PluginDefaultType;
