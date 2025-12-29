import { ActionIcon, Center, Flexbox, type FlexboxProps } from '@lobehub/ui';
import { createStaticStyles , responsive } from 'antd-style';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  desc: css`
    font-size: 14px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
    ${responsive.sm} {
      font-size: 12px;
    }
  `,
  expend: css`
    position: absolute;
    inset-block-end: -12px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  more: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: bold;
    line-height: 1.4;
    ${responsive.sm} {
      font-size: 14px;
    }
  `,
}));

interface IndexCardProps extends Omit<FlexboxProps, 'title'> {
  desc?: ReactNode;
  expand?: boolean;
  extra?: ReactNode;
  icon?: ReactNode;
  moreTooltip?: string;
  onExpand?: () => void;
  onMoreClick?: () => void;
  title?: ReactNode;
}

const IndexCard = memo<IndexCardProps>(
  ({
    expand = true,
    onExpand,
    icon,
    className,
    onMoreClick,
    title,
    extra,
    moreTooltip,
    desc,
    children,
    ...rest
  }) => {
    return (
      <Flexbox
        style={{
          marginBottom: !expand ? 12 : undefined,
          maxWidth: '1024px',
          position: 'relative',
          width: '100%',
        }}
      >
        <Flexbox
          className={styles.card}
          style={{
            paddingBottom: !expand ? 12 : undefined,
          }}
        >
          {title && (
            <Flexbox
              align={'center'}
              className={styles.header}
              gap={16}
              horizontal
              justify={'space-between'}
              padding={16}
            >
              <Flexbox align={'center'} gap={12} horizontal>
                {icon}
                <Flexbox>
                  <div className={styles.title}>{title}</div>
                  {desc && <div className={styles.desc}>{desc}</div>}
                </Flexbox>
              </Flexbox>
              <Flexbox align={'center'} gap={8} horizontal>
                {extra}
                {onMoreClick && (
                  <ActionIcon
                    className={styles.more}
                    icon={ChevronRight}
                    onClick={onMoreClick}
                    size={{ blockSize: 32, borderRadius: '50%', size: 16 }}
                    title={moreTooltip}
                  />
                )}
              </Flexbox>
            </Flexbox>
          )}
          <Flexbox className={className} gap={16} padding={16} width={'100%'} {...rest}>
            {children}
          </Flexbox>
        </Flexbox>
        {!expand && (
          <Center className={styles.expend} height={24} width={24}>
            <ActionIcon
              icon={ChevronDown}
              onClick={onExpand}
              size={{ blockSize: 24, borderRadius: '50%', size: 16 }}
            />
          </Center>
        )}
      </Flexbox>
    );
  },
);

IndexCard.displayName = 'IndexCard';

export default IndexCard;
