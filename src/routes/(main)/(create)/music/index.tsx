'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import MusicWorkspace from './features/MusicWorkspace';
import PromptInput from './features/PromptInput';

const DesktopMusicPage = memo(() => (
  <CreateGenerationPage PromptInput={PromptInput} Workspace={MusicWorkspace} path="/music" />
));

DesktopMusicPage.displayName = 'DesktopMusicPage';

export default DesktopMusicPage;
