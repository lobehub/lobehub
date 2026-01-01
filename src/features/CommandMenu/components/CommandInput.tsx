import { Tag } from '@lobehub/ui';
import { Command } from 'cmdk';
import { ArrowLeft, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandMenuContext } from '../CommandMenuContext';
import { styles } from '../styles';
import { useCommandMenu } from '../useCommandMenu';
import type { ValidSearchType } from '../utils/queryParser';

const CommandInput = memo(() => {
  const { t } = useTranslation('common');

  const { handleBack } = useCommandMenu();
  const { menuContext, pages, page, search, setSearch, typeFilter, setTypeFilter } =
    useCommandMenuContext();

  const hasPages = pages.length > 0;

  // Get localized context name
  const contextName = t(`cmdk.context.${menuContext}`, { defaultValue: menuContext });

  const getTypeLabel = (type: ValidSearchType) => {
    return t(`cmdk.search.${type}`);
  };

  return (
    <>
      {(menuContext !== 'general' || typeFilter) && !hasPages && (
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
        {hasPages && (
          <Tag className={styles.backTag} icon={<ArrowLeft size={12} />} onClick={handleBack} />
        )}
        <Command.Input
          autoFocus
          onValueChange={setSearch}
          placeholder={
            page === 'ask-ai' ? t('cmdk.aiModePlaceholder') : t('cmdk.searchPlaceholder')
          }
          value={search}
        />
        {page !== 'ask-ai' && search.trim() ? (
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
