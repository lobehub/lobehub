'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import FileDetail from './FileDetail';
import FilePreview from './FilePreview';
import FullscreenModal from './FullscreenModal';

interface ModalPageClientProps {
  id: string;
}

const ModalPageClient = ({ id }: ModalPageClientProps) => {
  const router = useRouter();
  const handleClose = useCallback(() => {
    if (typeof window === 'undefined') return;

    const { pathname, search } = window.location;
    const basePath = pathname.replace(/\/modal\/?$/, '');

    router.replace(`${basePath || '/'}${search}`);
  }, [router]);

  return (
    <FullscreenModal detail={<FileDetail id={id} />} onClose={handleClose}>
      <FilePreview id={id} />
    </FullscreenModal>
  );
};

export default ModalPageClient;
