'use client';

import { createModal, Empty } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import CanvasFrame from '@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame';
import { useClientDataSWR } from '@/libs/swr';
import { canvasService } from '@/services/canvas';

interface CanvasModalProps {
  canvasId: string;
  page?: string;
  version?: number;
}

const CanvasModalContent = ({ canvasId, page, version }: CanvasModalProps) => {
  const { t } = useTranslation('portal');
  const { data, error, isLoading, mutate } = useClientDataSWR(
    ['canvas-modal-version', canvasId, version ?? 'latest'],
    () => canvasService.getVersion(canvasId, version),
  );

  return (
    <AsyncBoundary
      data={data}
      empty={<Empty description={t('canvas.notFound')} />}
      error={error}
      isEmpty={data === null}
      isLoading={isLoading}
      onRetry={() => {
        void mutate();
      }}
    >
      {data && <CanvasFrame canvasId={data.canvasId} page={page} version={data.version} />}
    </AsyncBoundary>
  );
};

const CanvasModalTitle = () => {
  const { t } = useTranslation('portal');
  return t('canvas.frameTitle');
};

export const createCanvasModal = (canvasId: string, version?: number, page?: string) =>
  createModal({
    content: <CanvasModalContent canvasId={canvasId} page={page} version={version} />,
    footer: null,
    maskClosable: true,
    styles: { content: { display: 'flex', height: '75vh', minHeight: 0, padding: 0 } },
    title: <CanvasModalTitle />,
    width: 'min(95vw, 1200px)',
  });
