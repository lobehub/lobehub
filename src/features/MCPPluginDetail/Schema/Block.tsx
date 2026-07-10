import { Flexbox, Tag } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/routes/(main)/community/features/Title';

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
        <Tabs
          activeKey={mode}
          items={[
            {
              key: ModeType.Docs,
              label: t('mcp.details.schema.mode.docs'),
            },
            {
              key: ModeType.JSON,
              label: 'JSON',
            },
          ]}
          onChange={(key) => setMode?.(key as ModeType)}
        />
      </Flexbox>
      <p style={{ marginBottom: 24 }}>{desc}</p>
      {children}
    </Flexbox>
  );
});

export default Block;
