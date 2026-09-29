'use client';

import type { DashboardLevelFilter } from '@lobechat/types';
import { Flexbox, Input, TextArea } from '@lobehub/ui';
import {
  Button,
  createModal,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDashboardStore } from '@/store/dashboard';

interface DashboardFormProps {
  initialTitle?: string;
  onSubmit: (value: { description?: string; title: string }) => Promise<void>;
  showDescription?: boolean;
  submitText: string;
}

const DashboardForm = memo<DashboardFormProps>(
  ({ initialTitle = '', onSubmit, showDescription, submitText }) => {
    const { t } = useTranslation(['dashboard', 'common']);
    const { close } = useModalContext();
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const trimmed = title.trim();

    const handleSubmit = async () => {
      if (!trimmed || loading) return;
      setLoading(true);
      try {
        await onSubmit({ description: description.trim() || undefined, title: trimmed });
        close();
      } catch (error) {
        console.error('[dashboard] form submit failed', error);
        toast.error(t('operationFailed', { ns: 'common' }));
      } finally {
        setLoading(false);
      }
    };

    return (
      <>
        <Flexbox gap={16} padding={16}>
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('form.titleLabel')}
            </Text>
            <Input
              autoFocus
              data-dashboard-title-input
              maxLength={200}
              placeholder={t('form.titlePlaceholder')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onPressEnter={() => void handleSubmit()}
            />
          </Flexbox>
          {showDescription && (
            <Flexbox gap={6}>
              <Text fontSize={13} weight={500}>
                {t('form.descriptionLabel')}
              </Text>
              <TextArea
                autoSize={{ maxRows: 6, minRows: 2 }}
                maxLength={2000}
                placeholder={t('form.descriptionPlaceholder')}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Flexbox>
          )}
        </Flexbox>
        <ModalFooter>
          <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
          <Button
            disabled={!trimmed}
            loading={loading}
            type={'primary'}
            onClick={() => void handleSubmit()}
          >
            {submitText}
          </Button>
        </ModalFooter>
      </>
    );
  },
);

DashboardForm.displayName = 'DashboardForm';

/** Create a board at `level` (personal when empty) and hand the new row to `onCreated`. */
export const openCreateDashboardModal = ({
  level = {},
  onCreated,
}: {
  level?: DashboardLevelFilter;
  onCreated?: (dashboard: { id: string }) => void;
} = {}) =>
  createModal({
    content: (
      <DashboardForm
        showDescription
        submitText={translate('create.submit', { ns: 'dashboard' })}
        onSubmit={async ({ description, title }) => {
          const dashboard = await useDashboardStore
            .getState()
            .createDashboard({ ...level, description, title });
          if (dashboard) onCreated?.(dashboard);
        }}
      />
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('create.title', { ns: 'dashboard' }),
    width: 460,
  });

export const openRenameDashboardModal = ({
  dashboardId,
  level,
  title,
}: {
  dashboardId: string;
  level?: DashboardLevelFilter;
  title: string;
}) =>
  createModal({
    content: (
      <DashboardForm
        initialTitle={title}
        submitText={translate('save', { ns: 'common' })}
        onSubmit={({ title: nextTitle }) =>
          useDashboardStore.getState().renameDashboard(dashboardId, nextTitle, level)
        }
      />
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('rename.title', { ns: 'dashboard' }),
    width: 460,
  });
