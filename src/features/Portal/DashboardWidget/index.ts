import { createElement, memo } from 'react';

import { DashboardFeatureGate } from '@/features/Dashboard/FeatureGate';

import { type PortalImpl } from '../type';
import BodyContent from './Body';
import TitleContent from './Title';
import { useDashboardWidgetMoreMenu } from './useMoreMenu';

// Nothing of the widget view renders while the `dashboard` flag is off.
const Body = memo(() => createElement(DashboardFeatureGate, null, createElement(BodyContent)));
const Title = memo(() => createElement(DashboardFeatureGate, null, createElement(TitleContent)));

export const DashboardWidget: PortalImpl = {
  Body,
  Title,
  useMoreMenu: useDashboardWidgetMoreMenu,
};
