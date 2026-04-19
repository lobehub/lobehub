import { Edit } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const editAction = defineAction({
  key: 'edit',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);

    return useMemo(() => {
      // group edits the inner content block; other roles edit the message itself
      const targetId = ctx.role === 'group' ? ctx.contentBlock?.id : ctx.id;

      return {
        handleClick: () => {
          if (!targetId) return;
          toggleMessageEditing(targetId, true);
        },
        icon: Edit,
        key: 'edit',
        label: t('edit'),
      };
    }, [t, ctx.role, ctx.id, ctx.contentBlock?.id, toggleMessageEditing]);
  },
});
