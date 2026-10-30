import { agentDisplayName } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Command } from 'cmdk';
import { ArrowLeft, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useCommandMenuContext } from '../CommandMenuContext';
import { styles } from '../styles';
import { useCommandMenu } from '../useCommandMenu';
import { type ValidSearchType } from '../utils/queryParser';

interface CommandInputProps {
  onInputChange: (value: string) => void;
  onTypeFilterChange: () => void;
}

const CommandInput = memo<CommandInputProps>(({ onInputChange, onTypeFilterChange }) => {
  const { t } = useTranslation('common');

  const { handleBack } = useCommandMenu();
  const {
    menuContext,
    pages,
    page,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    selectedAgent,
    setSelectedAgent,
    activeAgentId,
  } = useCommandMenuContext();

  const activeAgentMeta = useAgentStore((s) =>
    activeAgentId ? agentSelectors.getAgentMetaById(activeAgentId)(s) : undefined,
  );

  const hasPages = pages.length > 0;
  const hasSelectedAgent = !!selectedAgent;
  const hasActiveAgent = !!activeAgentId && menuContext === 'agent';

  // Get localized context name
  const contextName = t(`cmdk.context.${menuContext}`, { defaultValue: menuContext });

  const getTypeLabel = (type: ValidSearchType) => {
    return t(`cmdk.search.${type}`);
  };

  const getPlaceholder = () => {
    if (hasSelectedAgent) {
      return t('cmdk.askAgentPlaceholder', { agent: agentDisplayName(selectedAgent) });
    }
    if (page === 'ask-ai') {
      return t('cmdk.aiModePlaceholder');
    }
    return t('cmdk.searchPlaceholder');
  };

  return (
    <>
      {(menuContext !== 'general' || typeFilter) && !hasPages && !hasSelectedAgent && (
        <div {...stylex.props(styles.contextWrapper)}>
          {hasActiveAgent ? (
            <Tag
              {...stylex.props(styles.contextTag)}
              icon={
                <AgentAvatar
                  agentId={activeAgentId}
                  avatar={activeAgentMeta?.avatar}
                  background={activeAgentMeta?.backgroundColor}
                  name={agentDisplayName(activeAgentMeta, t('defaultAgent'))}
                  shape="square"
                  size={14}
                />
              }
            >
              {agentDisplayName(activeAgentMeta, t('defaultAgent'))}
            </Tag>
          ) : (
            menuContext !== 'general' && (
              <Tag {...stylex.props(styles.contextTag)}>{contextName}</Tag>
            )
          )}
          {typeFilter && (
            <Tag
              {...stylex.props(styles.backTag)}
              icon={<X size={12} />}
              onClick={() => {
                onTypeFilterChange();
                setTypeFilter(undefined);
              }}
            >
              {getTypeLabel(typeFilter)}
            </Tag>
          )}
        </div>
      )}
      <div {...stylex.props(styles.inputWrapper)}>
        {hasPages && !hasSelectedAgent && (
          <Tag
            {...stylex.props(styles.backTag)}
            icon={<ArrowLeft size={12} />}
            onClick={handleBack}
          />
        )}
        {hasSelectedAgent && (
          <Tag
            closable
            icon={
              <AgentAvatar
                agentId={selectedAgent.id}
                avatar={selectedAgent.avatar}
                name={agentDisplayName(selectedAgent)}
                shape="square"
                size={14}
              />
            }
            onClose={() => setSelectedAgent(undefined)}
          >
            {agentDisplayName(selectedAgent)}
          </Tag>
        )}
        <Command.Input
          autoFocus
          maxLength={500}
          placeholder={getPlaceholder()}
          value={search}
          onValueChange={(value) => {
            onInputChange(value);
            setSearch(value);
          }}
        />
        {page !== 'ask-ai' && !hasSelectedAgent && search.trim() ? (
          <>
            <span style={{ fontSize: '14px', opacity: 0.6 }}>{t('cmdk.askAI')}</span>
            <Tag>{t('cmdk.keyboard.Tab')}</Tag>
          </>
        ) : (
          <Tag>{t('cmdk.keyboard.ESC')}</Tag>
        )}
      </div>
    </>
  );
});

CommandInput.displayName = 'CommandInput';

export default CommandInput;
