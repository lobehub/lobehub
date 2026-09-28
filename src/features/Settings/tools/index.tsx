'use client';

import { ENABLE_TOOL_CHANNEL_SETTINGS } from '@lobechat/business-const';
import { Navigate } from 'react-router';

import ToolSetting from '@/features/ToolSetting';

const Page = () => {
  // Hidden entries can still be reached by URL; send those visits back.
  if (!ENABLE_TOOL_CHANNEL_SETTINGS) return <Navigate replace to="/settings" />;

  return <ToolSetting />;
};

export default Page;
