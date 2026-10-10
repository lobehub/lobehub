'use client';

import { Center, createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Check } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
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
}

const CaptureSuccess: FC<CaptureSuccessProps> = ({ datasetName }) => {
  const { t } = useTranslation('eval');

  return (
    <Center gap={16} paddingBlock={40}>
      <Center className={styles.mark}>
        <Icon icon={Check} size={26} />
      </Center>
      <Flexbox align="center" gap={6}>
        <Text style={{ fontSize: 16, fontWeight: 600 }}>{t('capture.saved')}</Text>
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
