'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import StatsSetting from '@/routes/(main)/settings/stats';

import { SubscriptionIframeWrapper } from './SubscriptionIframeWrapper';

const Usage = memo(() => {
  if (!isDesktop) return <StatsSetting />;
  return <SubscriptionIframeWrapper page="usage" />;
});

Usage.displayName = 'Usage';
export default Usage;
