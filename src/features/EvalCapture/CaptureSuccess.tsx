'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  mark: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
});

export interface CaptureSuccessProps {
  datasetName: string;
}

const CaptureSuccess: FC<CaptureSuccessProps> = ({ datasetName }) => {
  const { t } = useTranslation('eval');

  return (
    <Center gap={16} paddingBlock={40}>
      <Center className={stylex.props(styles.mark).className}>
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
