import { Accordion } from '@lobehub/ui/base-ui';
import { createStaticStyles, responsive } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    border-radius: ${cssVar.borderRadius};
    color: ${cssVar.colorTextDescription};

    ${responsive.sm} {
      border-radius: 0;
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
  return (
    <Accordion
      classNames={{ header: styles.header }}
      indicatorPlacement={'end'}
      styles={{ trigger: { paddingInline: '16px 10px' } }}
      value={activeKey}
      items={items.map((item) => ({
        action: item.extra,
        children: item.children,
        key: item.key,
        title: item.label,
      }))}
      onValueChange={onChange}
    />
  );
});

export default CollapseGroup;
