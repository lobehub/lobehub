import { Button, Center, Empty, Spin } from '@lobehub/ui';
import { LayoutDashboardIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const BoardEmpty = () => {
  const { t } = useTranslation('project');
  return (
    <Center height={'100%'} padding={24}>
      <Empty
        description={t('artboard.empty.desc')}
        icon={LayoutDashboardIcon}
        title={t('artboard.empty.title')}
      />
    </Center>
  );
};

export const BoardLoading = () => (
  <Center flex={1} height={'100%'}>
    <Spin />
  </Center>
);

export const BoardError = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation('project');
  return (
    <Center flex={1} height={'100%'} padding={24}>
      <Empty
        description={t('artboard.error.desc')}
        icon={TriangleAlertIcon}
        title={t('artboard.error.title')}
        action={
          <Button icon={RotateCcwIcon} onClick={onRetry}>
            {t('artboard.error.retry')}
          </Button>
        }
      />
    </Center>
  );
};
