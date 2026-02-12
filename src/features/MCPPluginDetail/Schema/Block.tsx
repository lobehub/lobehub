import { Flexbox, Segmented, Tag } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '../../../app/[variants]/(main)/community/features/Title';
import { ModeType } from './types';

interface BlockProps {
  children?: ReactNode;
  count: number;
  desc: string;
  id?: string;
  mode?: ModeType;
  setMode?: (mode: ModeType) => void;
  title: string;
}

const Block = memo<BlockProps>(({ title, count, desc, children, mode, setMode, id }) => {
  const { t } = useTranslation('discover');
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Title id={id} tag={<Tag>{count}</Tag>}>
          {title}
        </Title>
        <Segmented
          shape={'round'}
          value={mode}
          variant={'outlined'}
          options={[
            {
              label: t('mcp.details.schema.mode.docs'),
              value: ModeType.Docs,
            },
            {
              label: 'JSON',
              value: ModeType.JSON,
            },
          ]}
          onChange={(v) => setMode?.(v as ModeType)}
        />
      </Flexbox>
      <p style={{ marginBottom: 24 }}>{desc}</p>
      {children}
    </Flexbox>
  );
});

export default Block;
