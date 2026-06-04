'use client';

import { Button, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlusIcon, Store } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { createSkillStoreModal } from '@/features/SkillStore';

import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import SkillList from './features/SkillList';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const useStyles = createStaticStyles(({ css, cssVar }) => ({
  detail: css`
    overflow-y: auto;
    flex: 1;
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  left: css`
    overflow-y: auto;
    width: 300px;
    min-width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  leftHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    height: 100%;
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const [selected, setSelected] = useState<SelectedTool | null>(null);

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    setSelected({ identifier, type });
  };

  return (
    <>
      <NavHeader />
      <div className={styles.root}>
        {/* Left: unified skill list */}
        <div className={styles.left}>
          <div className={styles.leftHeader}>
            <span style={{ fontWeight: 600 }}>{t('tab.skill')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button icon={<Icon icon={PlusIcon} />} size="small" onClick={handleOpenStore} />
              <Button icon={<Icon icon={Store} />} size="small" onClick={handleOpenStore}>
                {t('skillStore.button')}
              </Button>
            </div>
          </div>
          <div style={{ padding: '4px 8px' }}>
            <SkillList selectedIdentifier={selected?.identifier} onSelect={handleSelect} />
          </div>
        </div>

        {/* Right: tool detail + permissions */}
        {selected ? (
          <div className={styles.detail}>
            <SkillDetail identifier={selected.identifier} type={selected.type} />
          </div>
        ) : (
          <div className={styles.empty}>
            {t('skillDetail.selectHint', 'Select a skill to configure its tool permissions')}
          </div>
        )}
      </div>
    </>
  );
});

Page.displayName = 'SkillSettings';

export default Page;
