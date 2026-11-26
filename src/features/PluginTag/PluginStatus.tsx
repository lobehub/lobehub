import { ActionIcon, Badge, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LucideTrash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ManifestPreviewer from '@/components/ManifestPreviewer';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { customPluginSelectors, toolSelectors } from '@/store/tool/selectors';

interface PluginStatusProps {
  deprecated?: boolean;
  id: string;
  title?: string;
}
const PluginStatus = memo<PluginStatusProps>(({ title, id, deprecated }) => {
  const { t } = useTranslation();
  const [status, installError, isCustom] = useToolStore((s) => [
    toolSelectors.getManifestLoadingStatus(id)(s),
    toolSelectors.getPluginInstallError(id)(s),
    customPluginSelectors.isCustomPlugin(id)(s),
  ]);

  const manifest = useToolStore(toolSelectors.getManifestById(id), isEqual);

  const removePlugin = useAgentStore((s) => s.removePlugin);

  const renderStatus = useMemo(() => {
    switch (status) {
      case 'loading': {
        return <Badge color={'blue'} status={'processing'} />;
      }
      case 'error': {
        return <Badge status={'error'} />;
      }

      default:
      case 'success': {
        return <Badge status={'success'} />;
      }
    }
  }, [status]);

  const tag =
    // Deprecated tag
    deprecated ? (
      <Tag color={'red'} style={{ marginRight: 0 }} variant={'filled'}>
        {t('list.item.deprecated.title', { ns: 'plugin' })}
      </Tag>
    ) : // Custom tag
    isCustom ? (
      <Tag color={'gold'} variant={'filled'}>
        {t('list.item.local.title', { ns: 'plugin' })}
      </Tag>
    ) : null;

  return (
    <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
      <Flexbox gap={2}>
        <Flexbox horizontal align={'center'} gap={8}>
          {title || id}
          {tag}
        </Flexbox>
        {installError ? (
          <Text fontSize={12} type={'danger'}>
            {t(`error.${installError.message}`, {
              defaultValue: installError.cause,
              error: installError.cause,
              ns: 'plugin',
            })}
          </Text>
        ) : null}
      </Flexbox>

      {deprecated ? (
        <ActionIcon
          icon={LucideTrash2}
          size={'small'}
          title={t('plugin.clearDeprecated', { ns: 'setting' })}
          onClick={(e) => {
            e.stopPropagation();
            removePlugin(id);
          }}
        />
      ) : (
        <Flexbox horizontal align={'center'}>
          <ManifestPreviewer manifest={manifest || {}} trigger={'hover'}>
            <Button icon={renderStatus} size={'small'} type={'text'} />
          </ManifestPreviewer>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default PluginStatus;
