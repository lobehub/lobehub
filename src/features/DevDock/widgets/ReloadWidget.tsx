'use client';

import { RotateCw } from 'lucide-react';
import { memo } from 'react';

import BarButton from './BarButton';

const ReloadWidget = memo(() => (
  <BarButton icon={RotateCw} label={'Reload'} onClick={() => window.location.reload()} />
));

ReloadWidget.displayName = 'DevDockReloadWidget';

export default ReloadWidget;
