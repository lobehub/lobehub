'use client';

import { Button, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { type InputRef } from 'antd';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';

const GENERATE_SWR_KEY = 'document-to-skill-meta';
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
   * Stable SWR cache key for the generation request. Required alongside
   * `onGenerate` so the auto-generation dedupes and is lifecycle-safe.
   */
  generateCacheKey?: unknown;
  /**
   * Auto-generate skill metadata from the document content. Runs automatically
   * when the modal opens (via SWR), and again when the user clicks regenerate.
   * Return the metadata to prefill the form, or undefined when generation fails
   * (an inline error is shown). Omit to disable auto-generation entirely.
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
  ({ defaultName, defaultTitle, defaultDescription, generateCacheKey, onGenerate, onSubmit }) => {
    const { t: tChat } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    const [name, setName] = useState(defaultName);
    const [title, setTitle] = useState(defaultTitle);
    const [description, setDescription] = useState(defaultDescription);
    const [loading, setLoading] = useState(false);
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

    // Auto-generate on open via SWR: runs once on mount and dedupes rapid
    // re-mounts (e.g. StrictMode). Focus/reconnect revalidation and error retry
    // are disabled — regenerating burns tokens + writes a tracing row, so it
    // must only fire on open or via the explicit Regenerate action (`mutate`).
    const { isValidating: generating, mutate: regenerate } = useClientDataSWR<
      GeneratedSkillMeta | undefined
    >(onGenerate ? (generateCacheKey ?? GENERATE_SWR_KEY) : null, () => onGenerate!(), {
      dedupingInterval: 2000,
      onError: () => setError(tChat('workingPanel.skills.convert.generateError')),
      onSuccess: (meta) => {
        if (!meta) {
          setError(tChat('workingPanel.skills.convert.generateError'));
          return;
        }
        // The model is instructed to return kebab-case, but slugify
        // defensively so an off-spec name still lands in a valid state. The
        // baseline for the edit diff is the value actually placed in the form
        // (post-slugify), so a pure normalization never reads as a user edit.
        const values: ConvertSkillMeta = {
          description: meta.description,
          name: slugifySkillName(meta.name) || meta.name,
          title: meta.title,
        };
        setName(values.name);
        setTitle(values.title);
        setDescription(values.description);
        setError(undefined);
        generatedRef.current = { tracingId: meta.tracingId, values };
        // Fields are disabled while generating, so the mount focus no-ops;
        // focus the name once values land so the user can edit immediately.
        queueMicrotask(() => nameRef.current?.focus());
      },
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    });

    const handleRegenerate = useCallback(() => {
      setError(undefined);
      void regenerate();
    }, [regenerate]);

    const trimmedName = name.trim();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const nameInvalid = useMemo(
      () => !!trimmedName && !SKILL_NAME_PATTERN.test(trimmedName),
      [trimmedName],
    );
    const busy = loading || generating;
    const canSubmit = !!trimmedName && !nameInvalid && !!trimmedTitle && !!trimmedDescription;

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
            <Button icon={Sparkles} loading={generating} size={'small'} onClick={handleRegenerate}>
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
  generateCacheKey?: unknown;
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
        generateCacheKey={options.generateCacheKey}
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
