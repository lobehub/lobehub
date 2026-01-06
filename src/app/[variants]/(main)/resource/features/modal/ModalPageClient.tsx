'use client';

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import FileDetail from './FileDetail';
import FilePreview from './FilePreview';
import FullscreenModal from './FullscreenModal';

interface ModalPageClientProps {
  id: string;
}

const ModalPageClient = ({ id }: ModalPageClientProps) => {
  const navigate = useNavigate();
  const handleClose = useCallback(() => {
    if (typeof window === 'undefined') return;

    const { pathname, search } = window.location;
    const basePath = pathname.replace(/\/modal\/?$/, '');

    navigate(`${basePath || '/'}${search}`, { replace: true });
  }, [navigate]);

  return (
    <FullscreenModal detail={<FileDetail id={id} />} onClose={handleClose}>
      <FilePreview id={id} />
    </FullscreenModal>
  );
};

export default ModalPageClient;
