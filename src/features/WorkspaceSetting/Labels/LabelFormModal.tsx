import { type AgentLabelListItem } from '@lobechat/types';
import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
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

interface LabelFormModalProps extends Pick<ModalProps, 'open' | 'onCancel'> {
  /** Present when editing; absent when creating. */
  /**
   * When creating from an agent's Labels submenu, apply the new label to that
   * agent right away — creating "for" an agent and then having to reopen the
   * picker would be surprising.
   */
  assignTo?: { agentId: string; currentLabelIds: string[] };
  label?: AgentLabelListItem;
  /**
   * Opened from a failed restore: the label is archived and its old name is
   * taken, so saving must also flip `archived` back off — otherwise the user
   * renames it and still has to find the restore action again.
   */
  restoreOnSave?: boolean;
}

const LabelFormModal = memo<LabelFormModalProps>(
  ({ assignTo, label, open, onCancel, restoreOnSave }) => {
    const { t } = useTranslation(['setting', 'common']);
    const [createAgentLabel, toggleAgentLabel, updateAgentLabel] = useHomeStore((s) => [
      s.createAgentLabel,
      s.toggleAgentLabel,
      s.updateAgentLabel,
    ]);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState<string>(DEFAULT_LABEL_COLOR);
    const [loading, setLoading] = useState(false);

    // Reset per open so the form reflects the target label (or a blank create).
    useEffect(() => {
      if (!open) return;
      setName(label?.name ?? '');
      setDescription(label?.description ?? '');
      setColor(label?.color ?? DEFAULT_LABEL_COLOR);
    }, [open, label]);

    return (
      <div onClick={stopPropagation}>
        <ImperativeModal
          destroyOnHidden
          okButtonProps={{ disabled: !name.trim() || !isValidLabelColor(color), loading }}
          open={open}
          width={420}
          title={
            restoreOnSave
              ? t('workspaceSetting.labels.form.restoreTitle')
              : label
                ? t('workspaceSetting.labels.form.editTitle')
                : t('workspaceSetting.labels.form.createTitle')
          }
          onCancel={onCancel}
          onOk={async (e) => {
            const trimmed = name.trim();
            if (!trimmed) return;

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
                  // Delta, not `[...currentLabelIds, id]`: those ids were
                  // captured when the modal opened, so replaying them as a full
                  // set would delete anything another editor applied while the
                  // user was typing.
                  await toggleAgentLabel(assignTo.agentId, id, true);
                }
              }
              onCancel?.(e as any);
            } catch (error) {
              // Keep the modal open on a name clash — the user's next move is to
              // edit the name they already typed, not to start over.
              if (isDuplicateLabelNameError(error)) {
                toast.error(t('workspaceSetting.labels.form.duplicateName'));
                return;
              }
              console.error('Failed to save label:', error);
              toast.error(t('operationFailed', { ns: 'common' }));
            } finally {
              setLoading(false);
            }
          }}
        >
          <Flexbox gap={16} paddingBlock={8}>
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
        </ImperativeModal>
      </div>
    );
  },
);

LabelFormModal.displayName = 'LabelFormModal';

export default LabelFormModal;
