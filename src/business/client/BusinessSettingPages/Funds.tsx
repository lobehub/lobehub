'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { SubscriptionIframeWrapper } from './SubscriptionIframeWrapper';

const Funds = memo(() => {
  if (!isDesktop) return null;
  return <SubscriptionIframeWrapper page="funds" />;
});

Funds.displayName = 'Funds';
export default Funds;
