'use client';

import { Button, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { Sparkles } from 'lucide-react';
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

/** Skill metadata the auto-generator returns and the form collects. */
export interface ConvertSkillMeta {
  description: string;
  name: string;
  title: string;
}

/** Generation result: the prefilled values plus the tracing id feedback attaches to. */
export interface GeneratedSkillMeta extends ConvertSkillMeta {
  tracingId: string;
}

/**
 * Implicit-feedback payload assembled on save when the form was prefilled by
 * generation: whether (and which fields) the user edited before saving, the
 * generated baseline, and the tracing id to attribute the signal to.
 */
export interface SkillMetaGenerationFeedback {
  edited: boolean;
  editedFields: string[];
  generated: ConvertSkillMeta;
  tracingId: string;
}

interface ConvertToSkillContentProps {
  defaultDescription: string;
  defaultName: string;
  defaultTitle: string;
  /**
   * Auto-generate skill metadata from the document content. Runs automatically
   * when the modal opens, and again when the user clicks regenerate. Return the
   * metadata to prefill the form, or undefined when generation fails (an inline
   * error is shown). Omit to disable auto-generation entirely.
   */
  onGenerate?: () => Promise<GeneratedSkillMeta | undefined>;
  /**
   * Convert the document into a skill. Return an error message to show inline and
   * keep the modal open; return undefined on success (the modal closes). When the
   * form was prefilled by generation, `generation` carries the edit diff for
   * implicit feedback.
   */
  onSubmit: (
    params: ConvertSkillMeta & { generation?: SkillMetaGenerationFeedback },
  ) => Promise<string | undefined>;
}

const ConvertToSkillContent = memo<ConvertToSkillContentProps>(
  ({ defaultName, defaultTitle, defaultDescription, onGenerate, onSubmit }) => {
    const { t: tChat } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    const [name, setName] = useState(defaultName);
    const [title, setTitle] = useState(defaultTitle);
    const [description, setDescription] = useState(defaultDescription);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string>();
    const nameRef = useRef<InputRef>(null);
    // The last generation's prefilled values + tracing id, used on save to
    // record whether the user edited the generation (implicit feedback).
    const generatedRef = useRef<{ tracingId: string; values: ConvertSkillMeta } | undefined>(
      undefined,
    );

    useEffect(() => {
      queueMicrotask(() => nameRef.current?.focus());
    }, []);

    const trimmedName = name.trim();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const nameInvalid = useMemo(
      () => !!trimmedName && !SKILL_NAME_PATTERN.test(trimmedName),
      [trimmedName],
    );
    const busy = loading || generating;
    const canSubmit = !!trimmedName && !nameInvalid && !!trimmedTitle && !!trimmedDescription;

    const handleGenerate = useCallback(async () => {
      if (!onGenerate || busy) return;
      setGenerating(true);
      setError(undefined);
      try {
        const meta = await onGenerate();
        if (!meta) {
          setError(tChat('workingPanel.skills.convert.generateError'));
          return;
        }
        // The model is instructed to return kebab-case, but slugify defensively
        // so an off-spec name still lands in a valid state.
        const values: ConvertSkillMeta = {
          description: meta.description,
          name: slugifySkillName(meta.name) || meta.name,
          title: meta.title,
        };
        setName(values.name);
        setTitle(values.title);
        setDescription(values.description);
        // Baseline for the edit diff is the value actually placed in the form
        // (post-slugify), so a pure normalization never reads as a user edit.
        generatedRef.current = { tracingId: meta.tracingId, values };
      } finally {
        setGenerating(false);
      }
    }, [busy, onGenerate, tChat]);

    // Auto-generate once when the modal opens.
    const autoGeneratedRef = useRef(false);
    useEffect(() => {
      if (!onGenerate || autoGeneratedRef.current) return;
      autoGeneratedRef.current = true;
      void handleGenerate();
    }, [onGenerate, handleGenerate]);

    const handleSubmit = useCallback(async () => {
      if (busy || !canSubmit) return;
      setLoading(true);
      try {
        const values: ConvertSkillMeta = {
          description: trimmedDescription,
          name: trimmedName,
          title: trimmedTitle,
        };
        let generation: SkillMetaGenerationFeedback | undefined;
        const gen = generatedRef.current;
        if (gen) {
          const editedFields = (['name', 'title', 'description'] as const).filter(
            (field) => values[field] !== gen.values[field],
          );
          generation = {
            edited: editedFields.length > 0,
            editedFields,
            generated: gen.values,
            tracingId: gen.tracingId,
          };
        }
        const message = await onSubmit({ ...values, generation });
        if (message) {
          setError(message);
          return;
        }
        close();
      } finally {
        setLoading(false);
      }
    }, [busy, canSubmit, close, onSubmit, trimmedDescription, trimmedName, trimmedTitle]);

    return (
      <Flexbox gap={16}>
        {onGenerate ? (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {generating
                ? tChat('workingPanel.skills.convert.generating')
                : tChat('workingPanel.skills.convert.generateHint')}
            </Text>
            <Button icon={Sparkles} loading={generating} size={'small'} onClick={handleGenerate}>
              {tChat('workingPanel.skills.convert.regenerate')}
            </Button>
          </Flexbox>
        ) : null}
        <Flexbox gap={6}>
          <Text type={'secondary'}>{tChat('workingPanel.skills.convert.nameLabel')}</Text>
          <Input
            disabled={generating}
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
          <Text type={'secondary'}>{tChat('workingPanel.skills.convert.titleLabel')}</Text>
          <Input
            disabled={generating}
            placeholder={tChat('workingPanel.skills.convert.titlePlaceholder')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(undefined);
            }}
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text type={'secondary'}>{tChat('workingPanel.skills.convert.descriptionLabel')}</Text>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            disabled={generating}
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
          <Button disabled={busy} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!canSubmit || generating}
            loading={loading}
            type={'primary'}
            onClick={handleSubmit}
          >
            {tChat('workingPanel.skills.convert.action')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

ConvertToSkillContent.displayName = 'ConvertToSkillContent';

/**
 * Collects a skill name / title / description, then converts an existing agent
 * document into a managed skill (direct migration — the original document
 * becomes the skill's SKILL.md). When `onGenerate` is provided, the fields are
 * auto-filled from the document on open and the user can regenerate or edit.
 */
export const openConvertToSkillModal = (options: {
  defaultDescription: string;
  defaultName: string;
  defaultTitle: string;
  onGenerate?: () => Promise<GeneratedSkillMeta | undefined>;
  onSubmit: (
    params: ConvertSkillMeta & { generation?: SkillMetaGenerationFeedback },
  ) => Promise<string | undefined>;
}): ModalInstance =>
  createModal({
    content: (
      <ConvertToSkillContent
        defaultDescription={options.defaultDescription}
        defaultName={options.defaultName}
        defaultTitle={options.defaultTitle}
        onGenerate={options.onGenerate}
        onSubmit={options.onSubmit}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingPanel.skills.convert.title', { ns: 'chat' }),
    width: 'min(90vw, 480px)',
  });
