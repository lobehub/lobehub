import { Accordion, createStaticStyles, responsive, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    border-radius: ${cssVar.borderRadius};
    color: ${cssVar.colorTextDescription};

    ${responsive.sm} {
      border-radius: 0;
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

export interface CollapseGroupItem {
  children: ReactNode;
  extra?: ReactNode;
  key: string;
  label: ReactNode;
}

interface CollapseGroupProps {
  activeKey?: string[];
  items: CollapseGroupItem[];
  onChange?: (keys: string[]) => void;
}

const CollapseGroup = memo<CollapseGroupProps>(({ activeKey, items, onChange }) => {
  const isMobile = useIsMobile();

  return (
    <Accordion
      classNames={{ header: styles.header }}
      indicatorPlacement={'end'}
      value={activeKey}
      items={items.map((item) => ({
        action: item.extra,
        alwaysShowAction: isMobile,
        children: item.children,
        key: item.key,
        title: <Text ellipsis>{item.label}</Text>,
      }))}
      styles={{
        header: isMobile ? { marginInline: 0 } : undefined,
        trigger: { minHeight: isMobile ? 44 : undefined, paddingInline: '16px 10px' },
      }}
      onValueChange={onChange}
    />
  );
});

export default CollapseGroup;
