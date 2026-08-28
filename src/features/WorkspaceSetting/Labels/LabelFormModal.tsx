import { type AgentLabelListItem } from '@lobechat/types';
import { Flexbox, Input } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';

import { DEFAULT_LABEL_COLOR, isValidLabelColor, LABEL_COLOR_PRESETS } from './constants';
import { isDuplicateLabelNameError } from './errors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  swatch: css`
    cursor: pointer;

    width: 20px;
    height: 20px;
    border: 2px solid transparent;
    border-radius: 50%;

    transition: transform 0.1s;

    &:hover {
      transform: scale(1.15);
    }
  `,
  swatchActive: css`
    border-color: ${cssVar.colorText};
  `,
}));

export interface LabelFormModalOptions {
  /**
   * When creating from an agent's Labels submenu, apply the new label to that
   * agent right away — creating "for" an agent and then having to reopen the
   * picker would be surprising.
   */
  assignTo?: { agentId: string; currentLabelIds: string[] };
  /** Present when editing; absent when creating. */
  label?: AgentLabelListItem;
  /**
   * Opened from a failed restore: the label is archived and its old name is
   * taken, so saving must also flip `archived` back off — otherwise the user
   * renames it and still has to find the restore action again.
   */
  restoreOnSave?: boolean;
}

const LabelFormContent = memo<LabelFormModalOptions>(({ assignTo, label, restoreOnSave }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const [createAgentLabel, toggleAgentLabel, updateAgentLabel] = useHomeStore((s) => [
    s.createAgentLabel,
    s.toggleAgentLabel,
    s.updateAgentLabel,
  ]);

  const [name, setName] = useState(label?.name ?? '');
  const [description, setDescription] = useState(label?.description ?? '');
  const [color, setColor] = useState<string>(label?.color ?? DEFAULT_LABEL_COLOR);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    try {
      if (label) {
        await updateAgentLabel(label.id, {
          ...(restoreOnSave ? { archived: false } : {}),
          color,
          description: description.trim() || null,
          name: trimmed,
        });
      } else {
        const id = await createAgentLabel({
          color,
          description: description.trim() || undefined,
          name: trimmed,
        });
        if (assignTo && id) {
          // Delta, not `[...currentLabelIds, id]`: those ids were captured when
          // the modal opened, so replaying them as a full set would delete
          // anything another editor applied while the user was typing.
          await toggleAgentLabel(assignTo.agentId, id, true);
        }
      }
      close();
    } catch (error) {
      // Keep the modal open on a name clash — the user's next move is to edit
      // the name they already typed, not to start over.
      if (isDuplicateLabelNameError(error)) {
        toast.error(t('workspaceSetting.labels.form.duplicateName'));
        return;
      }
      console.error('Failed to save label:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} paddingBlock={8} paddingInline={16}>
        <Flexbox gap={8}>
          <span>{t('workspaceSetting.labels.form.name')}</span>
          <Input
            autoFocus
            maxLength={40}
            placeholder={t('workspaceSetting.labels.form.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Flexbox>
        <Flexbox gap={8}>
          <span>{t('workspaceSetting.labels.form.description')}</span>
          <Input
            maxLength={200}
            placeholder={t('workspaceSetting.labels.form.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Flexbox>
        <Flexbox gap={8}>
          <span>{t('workspaceSetting.labels.form.color')}</span>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            {LABEL_COLOR_PRESETS.map((preset) => (
              <span
                aria-label={preset}
                className={cx(styles.swatch, color === preset && styles.swatchActive)}
                key={preset}
                role={'button'}
                style={{ background: preset }}
                onClick={() => setColor(preset)}
              />
            ))}
            <Input
              placeholder={'#RRGGBB'}
              style={{ width: 100 }}
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!name.trim() || !isValidLabelColor(color)}
          loading={loading}
          type={'primary'}
          onClick={handleSave}
        >
          {t('ok', { defaultValue: 'OK', ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
});

LabelFormContent.displayName = 'LabelFormContent';

export const openLabelFormModal = (options: LabelFormModalOptions = {}) =>
  createModal({
    content: <LabelFormContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate(
      options.restoreOnSave
        ? 'workspaceSetting.labels.form.restoreTitle'
        : options.label
          ? 'workspaceSetting.labels.form.editTitle'
          : 'workspaceSetting.labels.form.createTitle',
      { ns: 'setting' },
    ),
    width: 420,
  });
