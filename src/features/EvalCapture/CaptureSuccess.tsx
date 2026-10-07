'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, Info } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  existed: css`
    color: ${cssVar.colorInfo};
    background: ${cssVar.colorInfoBg};
  `,
  mark: css`
    width: 56px;
    height: 56px;
    border-radius: 50%;

    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
}));

export interface CaptureSuccessProps {
  datasetName: string;
  /** The answer was already a case in this dataset; nothing was written. */
  existed?: boolean;
}

const CaptureSuccess: FC<CaptureSuccessProps> = ({ datasetName, existed }) => {
  const { t } = useTranslation('eval');

  return (
    <Center gap={16} paddingBlock={40}>
      <Center className={existed ? `${styles.mark} ${styles.existed}` : styles.mark}>
        <Icon icon={existed ? Info : Check} size={26} />
      </Center>
      <Flexbox align="center" gap={6}>
        <Text style={{ fontSize: 16, fontWeight: 600 }}>
          {t(existed ? 'capture.existed' : 'capture.saved')}
        </Text>
        {existed && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('capture.existedHint')}
          </Text>
        )}
        {datasetName && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {datasetName}
          </Text>
        )}
      </Flexbox>
    </Center>
  );
};

export default CaptureSuccess;
