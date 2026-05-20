'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { SubscriptionIframeWrapper } from './SubscriptionIframeWrapper';

const Notification = memo(() => {
  if (!isDesktop) return null;

  return <SubscriptionIframeWrapper page="notification" />;
});

Notification.displayName = 'Notification';

export default Notification;
