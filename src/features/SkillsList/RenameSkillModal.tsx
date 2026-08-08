'use client';

import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface RenameSkillContentProps {
  /** The skill's current name — prefilled and selected for quick editing. */
  currentName: string;
  /**
   * Rename the skill. Return an error message to show inline and keep the modal
   * open; return undefined on success (the modal closes).
   */
  onSubmit: (name: string) => Promise<string | undefined>;
}

const RenameSkillContent = memo<RenameSkillContentProps>(({ currentName, onSubmit }) => {
  const { t: tChat } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    // Focus + select the whole name so the user can immediately retype.
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading) return;
    const name = value.trim();
    if (!name || name === currentName) return;
    setLoading(true);
    try {
      const message = await onSubmit(name);
      if (message) {
        setError(message);
        return;
      }
      close();
    } finally {
      setLoading(false);
    }
  }, [close, currentName, loading, onSubmit, value]);

  const trimmed = value.trim();
  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Input
          placeholder={tChat('workingPanel.skills.rename.placeholder')}
          ref={inputRef}
          value={value}
          onPressEnter={handleSubmit}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
        />
        {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button
          disabled={!trimmed || trimmed === currentName}
          loading={loading}
          type={'primary'}
          onClick={handleSubmit}
        >
          {tChat('workingPanel.skills.rename.action')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

RenameSkillContent.displayName = 'RenameSkillContent';

/**
 * Skill-name entry for renaming a skill. Prefills the current name and submits
 * the new one. Shared by the agent-skill and user-skill rows in the working
 * sidebar (both back onto a rename service); mirrors the branch rename modal.
 */
export const openRenameSkillModal = (options: {
  currentName: string;
  onSubmit: (name: string) => Promise<string | undefined>;
}): ModalInstance =>
  createModal({
    content: <RenameSkillContent currentName={options.currentName} onSubmit={options.onSubmit} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingPanel.skills.rename.title', { ns: 'chat' }),
    width: 'min(90vw, 480px)',
  });
