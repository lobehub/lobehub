'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { EditTitleArgs } from '@lobechat/editor-runtime';

import type { EditTitleState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  highlight: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.gold3} 40%, transparent 40%);
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const EditTitleInspector = memo<BuiltinInspectorProps<EditTitleArgs, EditTitleState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const title = args?.title || partialArgs?.title;

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        {title ? (
          <Trans
            components={{ title: <span className={styles.highlight} /> }}
            i18nKey="builtins.lobe-page-agent.apiName.editTitle.result"
            ns="plugin"
            values={{ title }}
          />
        ) : (
          <span>{t('builtins.lobe-page-agent.apiName.editTitle')}</span>
        )}
      </div>
    );
  },
);

EditTitleInspector.displayName = 'EditTitleInspector';

export default EditTitleInspector;
