import { Avatar, Tag } from '@lobehub/ui';
import { Command } from 'cmdk';
import { ArrowLeft, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandMenuContext } from '../CommandMenuContext';
import { styles } from '../styles';
import { useCommandMenu } from '../useCommandMenu';
import { type ValidSearchType } from '../utils/queryParser';

const CommandInput = memo(() => {
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
  } = useCommandMenuContext();

  const hasPages = pages.length > 0;
  const hasSelectedAgent = !!selectedAgent;

  // Get localized context name
  const contextName = t(`cmdk.context.${menuContext}`, { defaultValue: menuContext });

  const getTypeLabel = (type: ValidSearchType) => {
    return t(`cmdk.search.${type}`);
  };

  const getPlaceholder = () => {
    if (hasSelectedAgent) {
      return t('cmdk.askAgentPlaceholder', { agent: selectedAgent.title });
    }
    if (page === 'ask-ai') {
      return t('cmdk.aiModePlaceholder');
    }
    return t('cmdk.searchPlaceholder');
  };

  return (
    <>
      {(menuContext !== 'general' || typeFilter) && !hasPages && !hasSelectedAgent && (
        <div className={styles.contextWrapper}>
          {menuContext !== 'general' && <Tag className={styles.contextTag}>{contextName}</Tag>}
          {typeFilter && (
            <Tag
              className={styles.backTag}
              icon={<X size={12} />}
              onClick={() => setTypeFilter(undefined)}
            >
              {getTypeLabel(typeFilter)}
            </Tag>
          )}
        </div>
      )}
      <div className={styles.inputWrapper}>
        {hasPages && !hasSelectedAgent && (
          <Tag className={styles.backTag} icon={<ArrowLeft size={12} />} onClick={handleBack} />
        )}
        {hasSelectedAgent && (
          <Tag
            closable
            icon={
              <Avatar
                emojiScaleWithBackground
                avatar={selectedAgent.avatar}
                shape="square"
                size={14}
              />
            }
            onClose={() => setSelectedAgent(undefined)}
          >
            {selectedAgent.title}
          </Tag>
        )}
        <Command.Input
          autoFocus
          maxLength={500}
          placeholder={getPlaceholder()}
          value={search}
          onValueChange={setSearch}
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
