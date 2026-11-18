import { Icon } from '@lobehub/ui';
import { PanelsTopLeftIcon } from 'lucide-react';
import { type ComponentProps, lazy, Suspense } from 'react';

// The avatar pulls the whole `@lobehub/icons` set; a tab icon must not add it to
// the sidebar's first load, so it arrives after a plain placeholder
const PluginAvatar = lazy(() => import('@/components/Plugins/PluginAvatar'));

export const LazyPluginAvatar = (props: ComponentProps<typeof PluginAvatar>) => (
  <Suspense fallback={<Icon icon={PanelsTopLeftIcon} size={props.size} />}>
    <PluginAvatar {...props} />
  </Suspense>
);
