import { Flexbox } from '@lobehub/ui';
import { Tabs, Tag } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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
          <h2 className={styles.sectionTitle} id={id}>
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
      <p className={styles.sectionDesc} style={{ marginTop: -6 }}>
        {desc}
      </p>
      {children}
    </Flexbox>
  );
});

export default Block;
