'use client';

import { type SkillListItem } from '@lobechat/types';
import { Block, DropdownMenu, Flexbox, Icon, Button as LobeButton, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { MoreHorizontalIcon, Package, PuzzleIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 0;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 12px;

    font-size: 20px;

    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    font-size: 15px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface AgentSkillItemProps {
  skill: SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);

  const handleUninstall = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await deleteAgentSkill(skill.id);
        } finally {
          setLoading(false);
        }
      },
      title: t('store.actions.confirmUninstall', { ns: 'plugin' }),
      type: 'error',
    });
  };

  return (
    <Flexbox
      align="center"
      className={styles.container}
      gap={16}
      horizontal
      justify="space-between"
    >
      <Flexbox align="center" gap={12} horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <Block className={styles.icon} variant={'outlined'}>
          <PuzzleIcon size={20} />
        </Block>
        <Flexbox align="center" gap={8} horizontal style={{ overflow: 'hidden' }}>
          <span className={styles.title}>{skill.name}</span>
          <Tag icon={<Icon icon={PuzzleIcon} />} size={'small'} />
          <Tag color={'warning'} icon={<Icon icon={Package} />} size={'small'}>
            {t('store.customPlugin', { ns: 'plugin' })}
          </Tag>
        </Flexbox>
      </Flexbox>
      <DropdownMenu
        items={[
          {
            danger: true,
            icon: <Trash2 size={16} />,
            key: 'uninstall',
            label: t('store.actions.uninstall', { ns: 'plugin' }),
            onClick: handleUninstall,
          },
        ]}
        placement="bottomRight"
      >
        <LobeButton icon={MoreHorizontalIcon} loading={loading} />
      </DropdownMenu>
    </Flexbox>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
