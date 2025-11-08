import { ActionIcon, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { ItemType } from 'antd/es/menu/interface';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';
import { isDeprecatedEdition } from '@/const/version';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/slices/chat';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { EnabledProviderWithModels } from '@/types/aiProvider';

const useStyles = createStyles(({ css, prefixCls }) => ({
  menu: css`
    .${prefixCls}-dropdown-menu-item {
      display: flex;
      gap: 8px;
    }
    .${prefixCls}-dropdown-menu {
      &-item-group-title {
        padding-inline: 8px;
      }

      &-item-group-list {
        margin: 0 !important;
      }
    }
  `,
  tag: css`
    cursor: pointer;
  `,
}));

const menuKey = (provider: string, model: string) => `${provider}-${model}`;

interface IProps {
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  updating?: boolean;
}

const ModelSwitchPanel = memo<IProps>(({ children, onOpenChange, open }) => {
  const { t } = useTranslation('components');
  const { styles, theme } = useStyles();
  const [model, provider, updateAgentConfig] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    s.updateAgentConfig,
  ]);
  const { showLLM } = useServerConfigStore(featureFlagsSelectors);
  const router = useRouter();
  const enabledList = useEnabledChatModels();

  const items = useMemo<ItemType[]>(() => {
    const getModelItems = (provider: EnabledProviderWithModels) => {
      const items = provider.children.map((model) => ({
        key: menuKey(provider.id, model.id),
        label: <ModelItemRender {...model} {...model.abilities} />,
        onClick: async () => {
          await updateAgentConfig({ model: model.id, provider: provider.id });
        },
      }));

      // if there is empty items, add a placeholder guide
      if (items.length === 0)
        return [
          {
            key: `${provider.id}-empty`,
            label: (
              <Flexbox gap={8} horizontal style={{ color: theme.colorTextTertiary }}>
                {t('ModelSwitchPanel.emptyModel')}
                <Icon icon={LucideArrowRight} />
              </Flexbox>
            ),
            onClick: () => {
              router.push(
                isDeprecatedEdition
                  ? '/settings?active=llm'
                  : `/settings?active=provider&provider=${provider.id}`,
              );
            },
          },
        ];

      return items;
    };

    if (enabledList.length === 0)
      return [
        {
          key: `no-provider`,
          label: (
            <Flexbox gap={8} horizontal style={{ color: theme.colorTextTertiary }}>
              {t('ModelSwitchPanel.emptyProvider')}
              <Icon icon={LucideArrowRight} />
            </Flexbox>
          ),
          onClick: () => {
            router.push(isDeprecatedEdition ? '/settings?active=llm' : `/settings?active=provider`);
          },
        },
      ];

    // otherwise show with provider group
    return enabledList.map((provider) => ({
      children: getModelItems(provider),
      key: provider.id,
      label: (
        <Flexbox horizontal justify="space-between">
          <ProviderItemRender
            logo={provider.logo}
            name={provider.name}
            provider={provider.id}
            source={provider.source}
          />
          {showLLM && (
            <Link
              href={
                isDeprecatedEdition
                  ? '/settings?active=llm'
                  : `/settings?active=provider&provider=${provider.id}`
              }
            >
              <ActionIcon
                icon={LucideBolt}
                size={'small'}
                title={t('ModelSwitchPanel.goToSettings')}
              />
            </Link>
          )}
        </Flexbox>
      ),
      type: 'group',
    }));
  }, [enabledList]);

  const icon = <div className={styles.tag}>{children}</div>;

  return (
    <ActionDropdown
      menu={{
        // @ts-expect-error 等待 antd 修复
        activeKey: menuKey(provider, model),
        className: styles.menu,
        items,
        // 不加限高就会导致面板超长，顶部的内容会被隐藏
        // https://github.com/user-attachments/assets/9c043c47-42c5-46ef-b5c1-bee89376f042
        style: {
          maxHeight: 550,
          overflowY: 'scroll',
        },
      }}
      onOpenChange={onOpenChange}
      open={open}
      placement={'topLeft'}
      prefetch
    >
      {icon}
    </ActionDropdown>
  );
});

export default ModelSwitchPanel;
