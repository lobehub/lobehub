'use client';

import { Terminal } from 'lucide-react';
import { memo } from 'react';

import { electronDevtoolsService } from '@/services/electron/devtools';

import BarButton from './BarButton';

const OpenDevtoolsWidget = memo(() => (
  <BarButton
    icon={Terminal}
    label={'DevTools'}
    onClick={() => electronDevtoolsService.openDevtools()}
  />
));

OpenDevtoolsWidget.displayName = 'DevDockOpenDevtoolsWidget';

export default OpenDevtoolsWidget;
