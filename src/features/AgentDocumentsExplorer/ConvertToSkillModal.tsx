'use client';

import { Button, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 80;

/**
 * Derives a default skill name from a document title: lowercase, non-alphanumeric
 * runs collapsed to hyphens, trimmed. Returns '' when nothing usable remains
 * (e.g. a CJK-only title), in which case the user must type a name.
 */
export const slugifySkillName = (input: string): string =>
  input
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replaceAll(/-+$/g, '');

interface ConvertToSkillContentProps {
  defaultDescription: string;
  defaultName: string;
  /**
   * Convert the document into a skill. Return an error message to show inline and
   * keep the modal open; return undefined on success (the modal closes).
   */
  onSubmit: (params: { description: string; name: string }) => Promise<string | undefined>;
}

const ConvertToSkillContent = memo<ConvertToSkillContentProps>(
  ({ defaultName, defaultDescription, onSubmit }) => {
    const { t: tChat } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    const [name, setName] = useState(defaultName);
    const [description, setDescription] = useState(defaultDescription);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const nameRef = useRef<InputRef>(null);

    useEffect(() => {
      queueMicrotask(() => nameRef.current?.focus());
    }, []);

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const nameInvalid = useMemo(
      () => !!trimmedName && !SKILL_NAME_PATTERN.test(trimmedName),
      [trimmedName],
    );
    const canSubmit = !!trimmedName && !nameInvalid && !!trimmedDescription;

    const handleSubmit = useCallback(async () => {
      if (loading || !canSubmit) return;
      setLoading(true);
      try {
        const message = await onSubmit({ description: trimmedDescription, name: trimmedName });
        if (message) {
          setError(message);
          return;
        }
        close();
      } finally {
        setLoading(false);
      }
    }, [canSubmit, close, loading, onSubmit, trimmedDescription, trimmedName]);

    return (
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Text type={'secondary'}>{tChat('workingPanel.skills.convert.nameLabel')}</Text>
          <Input
            placeholder={tChat('workingPanel.skills.convert.namePlaceholder')}
            ref={nameRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
          />
          {nameInvalid ? (
            <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
              {tChat('workingPanel.skills.convert.nameInvalid')}
            </Text>
          ) : (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {tChat('workingPanel.skills.convert.nameHint')}
            </Text>
          )}
        </Flexbox>
        <Flexbox gap={6}>
          <Text type={'secondary'}>{tChat('workingPanel.skills.convert.descriptionLabel')}</Text>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            placeholder={tChat('workingPanel.skills.convert.descriptionPlaceholder')}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError(undefined);
            }}
          />
        </Flexbox>
        {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!canSubmit} loading={loading} type={'primary'} onClick={handleSubmit}>
            {tChat('workingPanel.skills.convert.action')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

ConvertToSkillContent.displayName = 'ConvertToSkillContent';

/**
 * Collects a stable skill name + description, then converts an existing agent
 * document into a managed skill (direct migration — the original document
 * becomes the skill's SKILL.md). Prefills the name from the document title.
 */
export const openConvertToSkillModal = (options: {
  defaultDescription: string;
  defaultName: string;
  onSubmit: (params: { description: string; name: string }) => Promise<string | undefined>;
}): ModalInstance =>
  createModal({
    content: (
      <ConvertToSkillContent
        defaultDescription={options.defaultDescription}
        defaultName={options.defaultName}
        onSubmit={options.onSubmit}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingPanel.skills.convert.title', { ns: 'chat' }),
    width: 'min(90vw, 480px)',
  });
