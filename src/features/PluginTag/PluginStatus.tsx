import { ActionIcon, Button, Flexbox, Tag } from '@lobehub/ui';
import { Badge } from 'antd';
import isEqual from 'fast-deep-equal';
import { LucideRotateCw, LucideTrash2, RotateCwIcon } from 'lucide-react';
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
  const [status, isCustom, reinstallCustomPlugin] = useToolStore((s) => [
    toolSelectors.getManifestLoadingStatus(id)(s),
    customPluginSelectors.isCustomPlugin(id)(s),
    s.reinstallCustomPlugin,
  ]);

  const manifest = useToolStore(toolSelectors.getManifestById(id), isEqual);

  const removePlugin = useAgentStore((s) => s.removePlugin);

  const renderStatus = useMemo(() => {
    switch (status) {
      case 'loading': {
        return <Badge color={'blue'} status={'processing'} />;
      }
      case 'error': {
        return (
          <ActionIcon
            icon={LucideRotateCw}
            size={'small'}
            title={t('retry')}
            onClick={() => {
              reinstallCustomPlugin(id);
            }}
          />
        );
      }

      default:
      case 'success': {
        return <Badge status={'success'} />;
      }
    }
  }, [status]);

  const tag =
    // 拒绝标签
    deprecated ? (
      <Tag color={'red'} style={{ marginRight: 0 }} variant={'filled'}>
        {t('list.item.deprecated.title', { ns: 'plugin' })}
      </Tag>
    ) : // 自定义标签
    isCustom ? (
      <Tag color={'gold'} variant={'filled'}>
        {t('list.item.local.title', { ns: 'plugin' })}
      </Tag>
    ) : null;

  return (
    <Flexbox horizontal gap={12} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={8}>
        {title || id}
        {tag}
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
          {isCustom ? (
            <ActionIcon
              icon={RotateCwIcon}
              size={'small'}
              title={t('dev.meta.manifest.refresh', { ns: 'plugin' })}
              onClick={(e) => {
                e.stopPropagation();
                reinstallCustomPlugin(id);
              }}
            />
          ) : null}
          <ManifestPreviewer manifest={manifest || {}} trigger={'hover'}>
            <Button icon={renderStatus} size={'small'} type={'text'} />
          </ManifestPreviewer>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default PluginStatus;
