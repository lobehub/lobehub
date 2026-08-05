'use client';

import { memo } from 'react';

import { ToolSettings } from '@/routes/(main)/settings/skill';

const Page = memo(() => <ToolSettings viewMode="connector" />);

Page.displayName = 'ConnectorSettings';

export default Page;
