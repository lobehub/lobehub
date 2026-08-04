'use client';

import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import AcceptanceViewer from '..';
import SWRMutateInitializer from './SWRMutateInitializer';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex: none;

    min-height: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgContainer};
  `,
}));

const WorkbenchAcceptanceDetail = memo(() => {
  const { t } = useTranslation(['verify', 'common']);
  const navigate = useNavigate();

  return (
    <Flexbox className={styles.page}>
      <SWRMutateInitializer />
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <ActionIcon
          icon={ArrowLeft}
          title={t('back', { ns: 'common' })}
          onClick={() => navigate('/acceptance')}
        />
        <Text strong>{t('acceptance.workspace.title')}</Text>
      </Flexbox>
      <div className={styles.body}>
        <AcceptanceViewer />
      </div>
    </Flexbox>
  );
});

WorkbenchAcceptanceDetail.displayName = 'WorkbenchAcceptanceDetail';

export default WorkbenchAcceptanceDetail;
