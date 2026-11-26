'use client';

import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import InlineField from '@/features/EnvironmentManager/InlineField';
import PanelSection from '@/features/EnvironmentManager/PanelSection';

interface EnvironmentNotesProps {
  canManage: boolean;
  notes?: string;
  onSave: (notes: string) => Promise<void>;
}

/**
 * Free-text notes on what a run needs from a machine — "`dev` needs at least
 * 8 GB of memory", "builds only on macOS". Read by whoever picks where the
 * work runs, the agent included; nothing checks them.
 */
export const EnvironmentNotes = ({ canManage, notes, onSave }: EnvironmentNotesProps) => {
  const { t } = useTranslation('project');

  return (
    <PanelSection desc={t('settings.environmentNotesHint')} title={t('settings.environmentNotes')}>
      {canManage ? (
        <InlineField
          multiline
          label={t('settings.environmentNotes')}
          placeholder={t('settings.environmentNotesPlaceholder')}
          value={notes ?? ''}
          onSave={(value) => onSave(value.trim())}
        />
      ) : (
        <Text type={notes ? undefined : 'secondary'}>
          {notes || t('settings.environmentNotesEmpty')}
        </Text>
      )}
    </PanelSection>
  );
};
