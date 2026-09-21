import { useEffect, useState } from 'react';

import type { FileUploadStatus } from '@/types/files/upload';

/** Acknowledge newly completed uploads without decorating already uploaded attachments. */
export const useUploadCompletion = (status: FileUploadStatus) => {
  const [previousStatus, setPreviousStatus] = useState(status);
  const [showCompletion, setShowCompletion] = useState(false);

  if (previousStatus !== status) {
    setPreviousStatus(status);
    setShowCompletion(status === 'success');
  }

  useEffect(() => {
    if (!showCompletion) return;

    const timer = setTimeout(() => setShowCompletion(false), 2000);
    return () => clearTimeout(timer);
  }, [showCompletion]);

  return showCompletion;
};
