'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { type BreadcrumbProps } from 'antd';
import { Breadcrumb } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { isDesktop } from '@/const/version';

import BackButton from './components/BackButton';
import ToggleLeftPanelButton from './ToggleLeftPanelButton';

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
    margin-block-start: ${isDesktop ? '' : '8px'};
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
        horizontal
        align={'center'}
        flex={1}
        gap={2}
        style={{
          overflow: 'hidden',
        }}
      >
        {showBack && (
          <BackButton
            to={backTo}
            size={{
              blockSize: 32,
              size: 16,
            }}
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
          separator={<Icon icon={ChevronRightIcon} />}
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
        />
      </Flexbox>
    );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.container}
        flex={'none'}
        justify={'space-between'}
        padding={6}
      >
        {leftContent}
        <Flexbox
          horizontal
          align={'center'}
          gap={2}
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
