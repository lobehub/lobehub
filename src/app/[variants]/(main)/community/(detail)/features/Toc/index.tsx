'use client';

import { type AnchorProps } from 'antd';
import { Anchor } from 'antd';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo, useMemo } from 'react';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/community/features/const';
import { isOnServerSide } from '@/utils/env';

import { createTOCTree } from './useToc';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    toc: css`
      a {
        line-height: 1.4 !important;
        white-space: normal !important;
      }

      .${prefixCls}-anchor {
        display: flex;
        flex-direction: column;
        gap: 8px;

        &::before {
          display: none;
        }

        .${prefixCls}-anchor-ink {
          display: none !important;
        }

        .${prefixCls}-anchor-link-title {
          overflow: hidden;
          display: box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;

          word-break: break-word;
        }

        .${prefixCls}-anchor-link-title,.${prefixCls}-anchor-link {
          margin: 0 !important;
          padding-block: 0 !important;
        }

        > .${prefixCls}-anchor-link {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-inline-start: 0 !important;
        }

        .${prefixCls}-anchor-link-title-active {
          color: ${cssVar.colorText} !important;
        }

        .${prefixCls}-anchor-link-title:not(.${prefixCls}-anchor-link-title-active) {
          color: ${cssVar.colorTextSecondary};

          &:hover {
            color: ${cssVar.colorText};
          }
        }
      }

      ${responsive.lg} {
        display: none;
      }
    `,
  };
});

const Toc = memo<AnchorProps>(({ items, className, ...rest }) => {
  const toc = useMemo(() => createTOCTree(items as any), [items]);

  return (
    <Anchor
      affix={false}
      className={cx(className, styles.toc)}
      items={toc}
      getContainer={
        isOnServerSide ? undefined : () => document.querySelector(`#${SCROLL_PARENT_ID}`) as any
      }
      {...rest}
    />
  );
});

export default Toc;
