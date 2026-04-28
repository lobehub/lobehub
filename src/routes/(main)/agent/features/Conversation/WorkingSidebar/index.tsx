import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import RightPanel from '@/features/RightPanel';
import { useGlobalStore } from '@/store/global';

import ProgressSection from './ProgressSection';
import ResourcesSection from './ResourcesSection';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex-shrink: 0;
  `,
}));

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation('chat');
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);

  return (
    <RightPanel stableLayout defaultWidth={360} maxWidth={720} minWidth={300}>
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          height={44}
          justify={'space-between'}
          paddingInline={16}
        >
          <Text strong>{t('workingPanel.resources')}</Text>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
        <Flexbox className={styles.body} gap={8} width={'100%'}>
          <ProgressSection />
          <ResourcesSection />
        </Flexbox>
      </Flexbox>
    </RightPanel>
  );
});

export default AgentWorkingSidebar;
