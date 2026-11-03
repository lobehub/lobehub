'use client';

import { memo } from 'react';

import CreateGenerationPage from '@/routes/(main)/(create)/features/CreateGenerationPage';

import ImageWorkspace from './features/ImageWorkspace';
import PromptInput from './features/PromptInput';
import { useImageReferenceUpload } from './features/PromptInput/useImageReferenceUpload';

const DesktopImagePage = memo(() => {
  const { canDropImage, handleUploadFiles } = useImageReferenceUpload();

  return (
    <CreateGenerationPage
      PromptInput={PromptInput}
      Workspace={ImageWorkspace}
      dragDisabled={!canDropImage}
      path="/image"
      onUploadFiles={handleUploadFiles}
    />
  );
});

DesktopImagePage.displayName = 'DesktopImagePage';

export default DesktopImagePage;
