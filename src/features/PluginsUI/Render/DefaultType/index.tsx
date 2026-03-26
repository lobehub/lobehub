import { Skeleton } from '@lobehub/ui';
import { memo,Suspense } from 'react';

import dynamic from '@/libs/next/dynamic';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import Loading from '../Loading';
import { useParseContent } from '../useParseContent';
import IFrameRender from './IFrameRender';

const SystemJsRender = dynamic(() => import('./SystemJsRender'), { ssr: false });

export interface PluginDefaultTypeProps {
  content: string;
  loading?: boolean;
  name?: string;
}

const PluginDefaultType = memo<PluginDefaultTypeProps>(({ content, name, loading }) => {
  const manifest = useToolStore(pluginSelectors.getToolManifestById(name || ''));

  const { isJSON, data } = useParseContent(content);

  if (!isJSON) {
    return loading && <Loading />;
  }

  if (!manifest?.ui) return;

  const ui = manifest.ui;

  if (!ui.url) return;

  if (ui.mode === 'module')
    return (
      <Suspense fallback={<Skeleton active style={{ width: 400 }} />}>
        <SystemJsRender content={data} name={name || 'unknown'} url={ui.url} />
      </Suspense>
    );

  return (
    <IFrameRender
      content={data}
      height={ui.height}
      name={name || 'unknown'}
      url={ui.url}
      width={ui.width}
    />
  );
});

export default PluginDefaultType;
