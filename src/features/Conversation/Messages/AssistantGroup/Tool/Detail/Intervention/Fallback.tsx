import {
  type ActivateToolsParams,
  ActivatorApiName,
  LobeActivatorIdentifier,
} from '@lobechat/builtin-tool-activator';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { safeParseJSON } from '@lobechat/utils';
import { ActionIcon, Avatar, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronRight, Edit3Icon } from 'lucide-react';
import { memo, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import KeyValueEditor from './KeyValueEditor';

const styles = stylex.create({
  collapseHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlock: '6px',
    paddingInline: '10px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
  },
  description: {
    paddingBlock: '8px',
    paddingInline: '16px',
    fontSize: cssVar.fontSize,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  reason: {
    marginBlockStart: '-4px',
    paddingBlockEnd: '8px',
    paddingInline: '16px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.45,
    color: cssVar.colorTextSecondary,
  },
});

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
    const message = useConversationStore((s) => dataSelectors.getDbMessageById(id)(s));
    const usesDurableServerClaim = Boolean(
      message?.pluginIntervention?.operationId && message.pluginIntervention.batchId,
    );
    const [pendingEditedArguments, setPendingEditedArguments] = useState<
      Record<string, unknown> | undefined
    >();
    const pendingEditedArgumentsRef = useRef<Record<string, unknown> | undefined>(undefined);

    const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier));
    const isBuiltin = builtinToolIdentifiers.includes(identifier);

    const toolTitle = isBuiltin
      ? t(`builtins.${identifier}.title`, { defaultValue: identifier, ns: 'plugin' })
      : (pluginHelpers.getPluginTitle(pluginMeta) ?? identifier);

    const actionTitle = isBuiltin
      ? t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: apiName, ns: 'plugin' })
      : apiName;

    const parsedArgs = useMemo(
      () => pendingEditedArguments ?? safeParseJSON(requestArgs || '') ?? {},
      [pendingEditedArguments, requestArgs],
    );
    const renderedArgs = useMemo(
      () =>
        pendingEditedArguments ? JSON.stringify(pendingEditedArguments, null, 2) : requestArgs,
      [pendingEditedArguments, requestArgs],
    );
    const argCount = typeof parsedArgs === 'object' ? Object.keys(parsedArgs).length : 0;
    const isActivateToolsIntervention =
      identifier === LobeActivatorIdentifier && apiName === ActivatorApiName.activateTools;
    const requestedToolIdentifiers = useMemo(() => {
      if (!isActivateToolsIntervention) return [];

      const identifiers = (parsedArgs as ActivateToolsParams | undefined)?.identifiers;
      if (!Array.isArray(identifiers)) return [];

      return identifiers.filter(
        (item): item is string => typeof item === 'string' && !!item.trim(),
      );
    }, [isActivateToolsIntervention, parsedArgs]);
    const activationReason = useMemo(() => {
      if (!isActivateToolsIntervention) return;

      const reason = (parsedArgs as ActivateToolsParams | undefined)?.reason;

      return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
    }, [isActivateToolsIntervention, parsedArgs]);
    const requestedToolNames = useToolStore(
      (s) =>
        requestedToolIdentifiers.map((toolIdentifier) => {
          const meta = toolSelectors.getMetaById(toolIdentifier)(s);
          return pluginHelpers.getPluginTitle(meta) ?? meta?.title ?? toolIdentifier;
        }),
      isEqual,
    );
    const actionTitleSuffix =
      requestedToolNames.length > 0 ? ` (${requestedToolNames.join(', ')})` : '';

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            if (usesDurableServerClaim) {
              pendingEditedArgumentsRef.current = editedObject;
              setPendingEditedArguments(editedObject);
            } else {
              await updatePluginArguments(toolCallId, editedObject, true);
            }
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments, usesDurableServerClaim],
    );

    if (isEditing)
      return (
        <Suspense fallback={<Arguments arguments={renderedArgs} />}>
          <KeyValueEditor
            initialValue={parsedArgs}
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
          toolArgs={parsedArgs}
          toolCallId={toolCallId}
          onBeforeApprove={() => pendingEditedArgumentsRef.current}
        />
      </Flexbox>
    );

    return (
      <Flexbox gap={4}>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.description).className}
          gap={6}
        >
          {pluginMeta?.avatar && (
            <Avatar
              avatar={pluginMeta.avatar}
              shape={'square'}
              size={16}
              style={{ flex: 'none' }}
              title={toolTitle}
            />
          )}
          <span>
            {toolTitle} → {actionTitle}
            {actionTitleSuffix}
          </span>
        </Flexbox>

        {activationReason && <div {...stylex.props(styles.reason)}>{activationReason}</div>}

        {argCount > 0 && (
          <>
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.collapseHeader).className}
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
            {showArgs && <Arguments arguments={renderedArgs} />}
          </>
        )}

        {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
      </Flexbox>
    );
  },
);

export default FallbackIntervention;
