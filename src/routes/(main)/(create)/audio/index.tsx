'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import AudioWorkspace from './features/AudioWorkspace';
import PromptInput from './features/PromptInput';

const DesktopAudioPage = memo(() => (
  <CreateGenerationPage PromptInput={PromptInput} Workspace={AudioWorkspace} path="/audio" />
));

DesktopAudioPage.displayName = 'DesktopAudioPage';

export default DesktopAudioPage;
