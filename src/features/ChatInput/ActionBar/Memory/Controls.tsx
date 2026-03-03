import { type UserMemoryEffort } from '@lobechat/types';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { BrainCircuit, CircleOff } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LevelSlider from '@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const MEMORY_EFFORT_LEVELS: readonly UserMemoryEffort[] = ['low', 'medium', 'high'];

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ToggleOption {
  description: string;
  icon: LucideIcon;
  label: string;
  value: 'off' | 'on';
}

const ToggleItem = memo<ToggleOption>(({ value, description, icon, label }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isEnabled = useAgentStore((s) =>
    chatConfigByIdSelectors.isMemoryToolEnabledById(agentId)(s),
  );

  const isActive = value === 'on' ? isEnabled : !isEnabled;

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      className={cx(styles.option, isActive && styles.active)}
      gap={12}
      onClick={async () => {
        await updateAgentChatConfig({ memory: { enabled: value === 'on' } });
      }}
    >
      <Center className={styles.icon} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1}>
        <div className={styles.title}>{label}</div>
        <div className={styles.description}>{description}</div>
      </Flexbox>
    </Flexbox>
  );
});

const Controls = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [isEnabled, effort] = useAgentStore((s) => [
    chatConfigByIdSelectors.isMemoryToolEnabledById(agentId)(s),
    chatConfigByIdSelectors.getMemoryToolEffortById(agentId)(s),
  ]);

  const toggleOptions: ToggleOption[] = [
    {
      description: t('memory.off.desc'),
      icon: CircleOff,
      label: t('memory.off.title'),
      value: 'off',
    },
    {
      description: t('memory.on.desc'),
      icon: BrainCircuit,
      label: t('memory.on.title'),
      value: 'on',
    },
  ];

  return (
    <Flexbox gap={4}>
      {toggleOptions.map((option) => (
        <ToggleItem {...option} key={option.value} />
      ))}
      {isEnabled && (
        <>
          <Divider style={{ margin: 0 }} />
          <Flexbox horizontal align={'center'} gap={16} padding={8}>
            <Flexbox flex={1} gap={4} style={{ minWidth: 100 }}>
              <div className={styles.title}>{t('memory.effort.title')}</div>
              <div className={styles.description}>{t('memory.effort.desc')}</div>
            </Flexbox>
            <Flexbox flex={1}>
              <LevelSlider<UserMemoryEffort>
                defaultValue="medium"
                levels={MEMORY_EFFORT_LEVELS}
                value={effort}
                marks={{
                  0: t('memory.effort.low.title'),
                  1: t('memory.effort.medium.title'),
                  2: t('memory.effort.high.title'),
                }}
                onChange={async (value) => {
                  await updateAgentChatConfig({ memory: { effort: value, enabled: true } });
                }}
              />
            </Flexbox>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

export default Controls;
