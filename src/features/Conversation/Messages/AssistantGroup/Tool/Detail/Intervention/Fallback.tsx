import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { safeParseJSON } from '@lobechat/utils';
import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown, ChevronRight, Edit3Icon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import KeyValueEditor from './KeyValueEditor';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapseHeader: css`
    cursor: pointer;
    user-select: none;

    padding-block: 6px;
    padding-inline: 16px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  avatar: css`
    font-size: 16px;
    line-height: 1;
  `,
  description: css`
    padding-block: 8px;
    padding-inline: 16px;
    font-size: 14px;
    color: ${cssVar.colorText};
  `,
}));

interface FallbackInterventionProps {
  actionsPortalTarget?: HTMLDivElement | null;
  apiName: string;
  assistantGroupId?: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const FallbackIntervention = memo<FallbackInterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId, assistantGroupId, actionsPortalTarget }) => {
    const { t } = useTranslation(['chat', 'plugin', 'common']);
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const [isEditing, setIsEditing] = useState(false);
    const [showArgs, setShowArgs] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);

    const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier));
    const isBuiltin = builtinToolIdentifiers.includes(identifier);

    const toolTitle = isBuiltin
      ? t(`builtins.${identifier}.title`, { defaultValue: identifier, ns: 'plugin' })
      : (pluginHelpers.getPluginTitle(pluginMeta) ?? identifier);

    const actionTitle = isBuiltin
      ? t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: apiName, ns: 'plugin' })
      : apiName;

    const parsedArgs = useMemo(() => safeParseJSON(requestArgs || '') ?? {}, [requestArgs]);
    const argCount = typeof parsedArgs === 'object' ? Object.keys(parsedArgs).length : 0;

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            await updatePluginArguments(toolCallId, editedObject, true);
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments],
    );

    if (isEditing)
      return (
        <Suspense fallback={<Arguments arguments={requestArgs} />}>
          <KeyValueEditor
            initialValue={safeParseJSON(requestArgs || '')}
            onCancel={handleCancel}
            onFinish={handleFinish}
          />
        </Suspense>
      );

    const actions = (
      <Flexbox horizontal justify={'flex-end'}>
        <ApprovalActions
          apiName={apiName}
          approvalMode={approvalMode}
          assistantGroupId={assistantGroupId}
          identifier={identifier}
          messageId={id}
          toolCallId={toolCallId}
        />
      </Flexbox>
    );

    return (
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" className={styles.description} gap={6}>
          {pluginMeta?.avatar && <span className={styles.avatar}>{pluginMeta.avatar}</span>}
          <span>
            {toolTitle} → {actionTitle}
          </span>
        </Flexbox>

        {argCount > 0 && (
          <>
            <Flexbox
              horizontal
              align="center"
              className={styles.collapseHeader}
              gap={4}
              onClick={() => setShowArgs(!showArgs)}
            >
              <Icon icon={showArgs ? ChevronDown : ChevronRight} size={14} />
              <span>
                {t('tool.intervention.viewParameters', {
                  count: argCount,
                  defaultValue: 'View parameters ({{count}})',
                })}
              </span>
              {showArgs && (
                <ActionIcon
                  icon={Edit3Icon}
                  size={'small'}
                  title={t('edit', { ns: 'common' })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                />
              )}
            </Flexbox>
            {showArgs && <Arguments arguments={requestArgs} />}
          </>
        )}

        {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
      </Flexbox>
    );
  },
);

export default FallbackIntervention;
