'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Breadcrumb, type BreadcrumbProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import { type ReactNode, memo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import ToggleLeftPanelButton from './ToggleLeftPanelButton';
import BackButton from './components/BackButton';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    ol {
      align-items: center;
    }
    .${prefixCls}-breadcrumb-separator {
      margin-inline: 4px;
    }
    .${prefixCls}-breadcrumb-link {
      display: flex !important;
      align-items: center !important;
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    }
    a.${prefixCls}-breadcrumb-link {
      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
  container: css`
    overflow: hidden;
    margin-block-start: 8px;
  `,
}));

interface SideBarHeaderLayoutProps {
  backTo?: string;
  breadcrumb?: BreadcrumbProps['items'];
  left?: ReactNode;
  right?: ReactNode;
  showBack?: boolean;
  showTogglePanelButton?: boolean;
}

const SideBarHeaderLayout = memo<SideBarHeaderLayoutProps>(
  ({
    left,
    right,
    backTo = '/',
    showBack = true,
    breadcrumb = [],
    showTogglePanelButton = true,
  }) => {
    const navigate = useNavigate();
    const leftContent = left ? (
      <Flexbox
        align={'center'}
        flex={1}
        gap={2}
        horizontal
        style={{
          overflow: 'hidden',
        }}
      >
        {showBack && (
          <BackButton
            size={{
              blockSize: 32,
              size: 16,
            }}
            to={backTo}
          />
        )}
        {left && typeof left === 'string' ? (
          <Text ellipsis fontSize={16} weight={500}>
            {left}
          </Text>
        ) : (
          left
        )}
      </Flexbox>
    ) : (
      <Flexbox flex={1} paddingInline={6}>
        <Breadcrumb
          className={styles.breadcrumb}
          items={[
            {
              href: '/',
              title: <Icon icon={HomeIcon} />,
            },
            ...breadcrumb,
          ].map((item) => ({
            ...item,
            onClick: (event) => {
              const href = item.href;
              if (href) {
                event.preventDefault();
                event.stopPropagation();
                flushSync(() => navigate(href));
              }
            },
          }))}
          separator={<Icon icon={ChevronRightIcon} />}
        />
      </Flexbox>
    );

    return (
      <Flexbox
        align={'center'}
        className={styles.container}
        flex={'none'}
        horizontal
        justify={'space-between'}
        padding={6}
      >
        {leftContent}
        <Flexbox
          align={'center'}
          gap={2}
          horizontal
          justify={'flex-end'}
          style={{
            overflow: 'hidden',
          }}
        >
          {showTogglePanelButton && <ToggleLeftPanelButton />}
          {right}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SideBarHeaderLayout;
