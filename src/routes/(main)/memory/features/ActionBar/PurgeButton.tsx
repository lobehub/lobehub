'use client';

import { ActionIcon, Button, Icon, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useUserMemoryStore } from '@/store/userMemory';

export const MEMORY_DETAIL_QUERY_KEYS = [
  'activityId',
  'contextId',
  'experienceId',
  'identityId',
  'preferenceId',
] as const;

interface Props {
  iconOnly?: boolean;
}

const PurgeButton = memo<Props>(({ iconOnly }) => {
  const { message, modal } = App.useApp();
  const { t } = useTranslation(['common', 'memory']);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const purgeAllMemories = useUserMemoryStore((s) => s.purgeAllMemories);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleClick = () => {
    modal.confirm({
      cancelText: translate('cancel', { ns: 'common' }),
      content: translate('purge.confirm'),
      okButtonProps: { danger: true, loading },
      okText: translate('confirm', { ns: 'common' }),
      onOk: async () => {
        try {
          setLoading(true);
          await purgeAllMemories();
          const nextSearchParams = new URLSearchParams(searchParams);

          for (const key of MEMORY_DETAIL_QUERY_KEYS) {
            nextSearchParams.delete(key);
          }

          setSearchParams(nextSearchParams, { replace: true });
          message.success(translate('purge.success'));
        } catch {
          message.error(translate('purge.error'));
          throw new Error('Failed to purge memories');
        } finally {
          setLoading(false);
        }
      },
      title: translate('purge.title'),
      type: 'warning',
    });
  };

  if (iconOnly) {
    return (
      <Tooltip title={translate('purge.action')}>
        <ActionIcon
          danger
          icon={Trash2Icon}
          loading={loading}
          size={DESKTOP_HEADER_ICON_SIZE}
          tooltipProps={{ placement: 'bottom' }}
          onClick={handleClick}
        />
      </Tooltip>
    );
  }

  return (
    <Button
      danger
      icon={<Icon icon={Trash2Icon} size={DESKTOP_HEADER_ICON_SIZE} />}
      loading={loading}
      size={'small'}
      style={{ maxWidth: 300 }}
      type={'primary'}
      onClick={handleClick}
    >
      {translate('purge.action')}
    </Button>
  );
});

export default PurgeButton;
