'use client';

import { memo } from 'react';

import { ToolSettings } from '@/features/Settings/skill';

const Page = memo(() => <ToolSettings viewMode="connector" />);

Page.displayName = 'ConnectorSettings';

export default Page;
