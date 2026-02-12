import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, usePopoverContext } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, ExternalLink, Settings, Store } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ToolsList, { toolsListStyles } from './ToolsList';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trailingIcon: css`
    opacity: 0.5;
  `,
}));

interface PopoverContentProps {
  items: ItemType[];
  onOpenStore: () => void;
}

const PopoverContent = memo<PopoverContentProps>(({ items, onOpenStore }) => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();

  const { close: closePopover } = usePopoverContext();

  return (
    <Flexbox gap={0}>
      <div
        style={{
          maxHeight: 500,
          overflowY: 'auto',
        }}
      >
        <ToolsList items={items} />
      </div>
      <div className={styles.footer}>
        <div
          className={toolsListStyles.item}
          role="button"
          tabIndex={0}
          onClick={() => {
            closePopover();
            onOpenStore();
          }}
        >
          <div className={toolsListStyles.itemIcon}>
            <Icon icon={Store} size={20} />
          </div>
          <div className={toolsListStyles.itemContent}>{t('skillStore.title')}</div>
          <Icon className={styles.trailingIcon} icon={ChevronRight} size={16} />
        </div>
        <div
          className={toolsListStyles.item}
          role="button"
          tabIndex={0}
          onClick={() => {
            closePopover();
            navigate('/settings/skill');
          }}
        >
          <div className={toolsListStyles.itemIcon}>
            <Icon icon={Settings} size={20} />
          </div>
          <div className={toolsListStyles.itemContent}>{t('tools.plugins.management')}</div>
          <Icon className={styles.trailingIcon} icon={ExternalLink} size={16} />
        </div>
      </div>
    </Flexbox>
  );
});

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;
