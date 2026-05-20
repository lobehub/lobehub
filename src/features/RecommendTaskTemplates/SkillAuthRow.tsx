import type { TaskTemplateSkillRequirement } from '@lobechat/const';
import { Button, Flexbox, Icon, Image, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getProviderMeta } from './providerMeta';
import { SkillConnectionPopupBlockedError, useSkillConnection } from './useSkillConnection';

interface SkillAuthRowProps {
  onError: (error: unknown) => void;
  spec: TaskTemplateSkillRequirement;
}

/**
 * Inline row for a single required/optional skill the user has not yet authorized.
 * Renders `null` once the provider is connected so the caller can collapse the
 * surrounding container without extra bookkeeping.
 */
export const SkillAuthRow = memo<SkillAuthRowProps>(({ spec, onError }) => {
  const { t } = useTranslation('taskTemplate');
  const specs = useMemo(() => [spec], [spec]);
  const meta = useMemo(() => getProviderMeta(spec), [spec]);
  const { connect, isAllConnected, isConnecting } = useSkillConnection(specs);

  const handleConnect = useCallback(async () => {
    try {
      await connect();
    } catch (error) {
      onError(error);
    }
  }, [connect, onError]);

  if (!meta || isAllConnected) return null;

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
        {typeof meta.icon === 'string' ? (
          <Image alt={meta.label} height={16} src={meta.icon} style={{ flex: 'none' }} width={16} />
        ) : (
          <Icon color={cssVar.colorText} fill={cssVar.colorText} icon={meta.icon} size={16} />
        )}
        <Text ellipsis fontSize={13}>
          {meta.label}
        </Text>
      </Flexbox>
      <Button loading={isConnecting} size={'small'} variant={'text'} onClick={handleConnect}>
        {t('action.connect.short')}
      </Button>
    </Flexbox>
  );
});

SkillAuthRow.displayName = 'SkillAuthRow';

export { SkillConnectionPopupBlockedError };
