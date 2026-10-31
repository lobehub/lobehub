import { Flexbox, Tabs, Tag } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { styles } from './style';
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
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          <h2 {...stylex.props(styles.sectionTitle)} id={id}>
            {title}
          </h2>
          <Tag>{count}</Tag>
        </Flexbox>
        <Tabs
          activeKey={mode}
          style={{ flex: 'none', width: 'auto' }}
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
      <p {...sx([styles.sectionDesc], undefined, { marginTop: -6 })}>{desc}</p>
      {children}
    </Flexbox>
  );
});

export default Block;
