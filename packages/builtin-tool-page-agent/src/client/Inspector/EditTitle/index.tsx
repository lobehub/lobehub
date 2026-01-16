'use client';

import type { EditTitleArgs } from '@lobechat/editor-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { EditTitleState } from '../../../types';

export const EditTitleInspector = memo<BuiltinInspectorProps<EditTitleArgs, EditTitleState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const title = args?.title || partialArgs?.title;

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        {title ? (
          <Trans
            components={{ title: <span className={highlightTextStyles.gold} /> }}
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
