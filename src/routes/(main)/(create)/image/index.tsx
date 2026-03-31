'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';

const DesktopImagePage = memo(() => (
  <CreateGenerationPage PromptInput={PromptInput} Workspace={ImageWorkspace} path="/image" />
));

DesktopImagePage.displayName = 'DesktopImagePage';

export default DesktopImagePage;
