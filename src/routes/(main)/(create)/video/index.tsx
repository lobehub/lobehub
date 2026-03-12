'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import PromptInput from './features/PromptInput';
import VideoWorkspace from './features/VideoWorkspace';

const DesktopVideoPage = memo(() => (
  <CreateGenerationPage PromptInput={PromptInput} Workspace={VideoWorkspace} path="/video" />
));

DesktopVideoPage.displayName = 'DesktopVideoPage';

export default DesktopVideoPage;
