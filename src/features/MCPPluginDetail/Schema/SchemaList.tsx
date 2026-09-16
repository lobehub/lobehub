import { Flexbox } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
} from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { styles } from './style';

interface SchemaListProps {
  activeKey?: string[];
  children?: ReactNode;
  setActiveKey?: (key: string[]) => void;
}

export const SchemaList = memo<SchemaListProps>(({ activeKey, setActiveKey, children }) => (
  <AccordionRoot
    style={{ overflow: 'hidden' }}
    value={activeKey}
    variant={'outlined'}
    onValueChange={(keys) => setActiveKey?.(keys as string[])}
  >
    {children}
  </AccordionRoot>
));

interface SchemaItemProps {
  children?: ReactNode;
  desc?: string;
  id: string;
  meta?: ReactNode;
  name: string;
  open?: boolean;
}

export const SchemaItem = memo<SchemaItemProps>(({ id, name, desc, meta, open, children }) => (
  <AccordionItem value={name}>
    <AccordionHeader>
      <AccordionTrigger style={{ paddingBlock: 12, paddingInline: 14 }}>
        <Flexbox horizontal align={'flex-start'} flex={1} gap={12} style={{ minWidth: 0 }}>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <span className={styles.name} id={id}>
              {name}
            </span>
            {desc && !open && <p className={styles.desc}>{desc}</p>}
          </Flexbox>
          {meta && <span className={styles.meta}>{meta}</span>}
        </Flexbox>
      </AccordionTrigger>
    </AccordionHeader>
    <AccordionPanel contentStyle={{ overflowX: 'auto', padding: '0 14px 16px 36px' }}>
      <Flexbox gap={14}>{children}</Flexbox>
    </AccordionPanel>
  </AccordionItem>
));

export const SchemaEmpty = memo<{ children: ReactNode }>(({ children }) => (
  <div className={styles.empty}>{children}</div>
));

export const SchemaSubtitle = memo<{ children: ReactNode }>(({ children }) => (
  <span className={styles.subtitle}>{children}</span>
));
