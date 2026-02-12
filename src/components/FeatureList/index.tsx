import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, responsive } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    width: 280px;
    margin-block-end: 0;
    color: ${cssVar.colorTextSecondary};

    ${responsive.sm} {
      line-height: ${cssVar.lineHeight};
    }
  `,
  iconCtnDark: css`
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: ${cssVar.blue1};
  `,
  iconCtnLight: css`
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: ${cssVar.geekblue1};
  `,
  iconDark: css`
    color: ${cssVar.blue};
  `,
  iconLight: css`
    color: ${cssVar.geekblue};
  `,
  title: css`
    margin-block-end: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: bold;
  `,
}));

export interface FeatureItem {
  avatar: LucideIcon;
  desc: string;
  title: string;
}
interface FeatureListProps {
  data: FeatureItem[];
}

const FeatureList = memo<FeatureListProps>(({ data }) => {
  const isDarkMode = useIsDark();

  return (
    <Flexbox gap={32}>
      {data.map((item) => {
        return (
          <Flexbox horizontal align={'flex-start'} gap={24} key={item.title}>
            <Center className={isDarkMode ? styles.iconCtnDark : styles.iconCtnLight}>
              <Icon
                className={isDarkMode ? styles.iconDark : styles.iconLight}
                icon={item.avatar}
                size={36}
              />
            </Center>
            <Flexbox gap={8}>
              <p className={styles.title}>{item.title}</p>
              <p className={styles.desc}>{item.desc}</p>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

export default FeatureList;
