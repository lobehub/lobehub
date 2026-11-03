'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import PromptInput from './features/PromptInput';
import { useVideoReferenceUpload } from './features/PromptInput/useVideoReferenceUpload';
import VideoWorkspace from './features/VideoWorkspace';

const DesktopVideoPage = memo(() => {
  const { canDropImage, handleUploadFiles } = useVideoReferenceUpload();

  return (
    <CreateGenerationPage
      PromptInput={PromptInput}
      Workspace={VideoWorkspace}
      dragDisabled={!canDropImage}
      path="/video"
      onUploadFiles={handleUploadFiles}
    />
  );
});

DesktopVideoPage.displayName = 'DesktopVideoPage';

export default DesktopVideoPage;
