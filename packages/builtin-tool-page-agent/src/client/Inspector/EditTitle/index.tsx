'use client';

import type { EditTitleArgs } from '@lobechat/editor-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, type ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { EditTitleState } from '../../../types';

type EditTitleTranslationProps = {
  components: { title: ReactElement };
  i18nKey: 'builtins.lobe-page-agent.apiName.editTitle.result';
  ns: 'plugin';
  values: { title: string };
};

// Keep the concrete key/value contract while avoiding react-i18next's recursive
// resource-key inference for this very large generated locale union.
const EditTitleTranslation = Trans as unknown as (props: EditTitleTranslationProps) => ReactElement;

export const EditTitleInspector = memo<BuiltinInspectorProps<EditTitleArgs, EditTitleState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const title = args?.title || partialArgs?.title;

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        {title ? (
          <EditTitleTranslation
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
