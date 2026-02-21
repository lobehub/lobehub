'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import {
  ReactCodeblockPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreatePlanParams } from '../../types';

const useStyles = createStyles(({ css, token }) => ({
  description: css`
    font-size: 14px;
    color: ${token.colorTextSecondary};
  `,
  title: css`
    font-size: 28px;
    font-weight: 600;
  `,
}));

const CreatePlanIntervention = memo<BuiltinInterventionProps<CreatePlanParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { t } = useTranslation('tool');
    const { styles } = useStyles();

    const [goal, setGoal] = useState(args?.goal || '');
    const [description, setDescription] = useState(args?.description || '');

    const editor = useEditor();
    const editorInitializedRef = useRef(false);

    // Track pending changes
    const pendingChangesRef = useRef<CreatePlanParams | null>(null);

    // Initialize editor content when args.context changes
    useEffect(() => {
      if (editor && args?.context && !editorInitializedRef.current) {
        editor.setDocument('text', args.context);
        editorInitializedRef.current = true;
      }
    }, [editor, args?.context]);

    // Get current context from editor
    const getContext = useCallback(() => {
      if (!editor) return args?.context || '';
      return (editor.getDocument('text') as unknown as string) || '';
    }, [editor, args?.context]);

    // Save function
    const save = useCallback(async () => {
      const context = getContext();
      const changes: CreatePlanParams = {
        context: context || undefined,
        description,
        goal,
      };

      // Always submit current state when approving
      await onArgsChange?.(changes);
      pendingChangesRef.current = null;
    }, [onArgsChange, goal, description, getContext]);

    // Register before approve callback
    useEffect(() => {
      return registerBeforeApprove?.('createPlan', save);
    }, [registerBeforeApprove, save]);

    const handleGoalChange = useCallback(
      (value: string) => {
        setGoal(value);
        pendingChangesRef.current = {
          context: getContext() || undefined,
          description,
          goal: value,
        };
      },
      [description, getContext],
    );

    const handleDescriptionChange = useCallback(
      (value: string) => {
        setDescription(value);
        pendingChangesRef.current = {
          context: getContext() || undefined,
          description: value,
          goal,
        };
      },
      [goal, getContext],
    );

    const handleContentChange = useCallback(() => {
      pendingChangesRef.current = {
        context: getContext() || undefined,
        description,
        goal,
      };
    }, [description, goal, getContext]);

    // Focus editor when pressing Enter in description
    const handleDescriptionKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          editor?.focus();
        }
      },
      [editor],
    );

    // Focus description when pressing Enter in goal
    const handleGoalKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Focus description textarea
        const descriptionTextarea = document.querySelector(
          '[data-testid="plan-description"]',
        ) as HTMLTextAreaElement;
        descriptionTextarea?.focus();
      }
    }, []);

    return (
      <Flexbox
        gap={8}
        paddingBlock={16}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {/* Goal - Main Title */}
        <TextArea
          autoSize={{ minRows: 1 }}
          className={styles.title}
          placeholder={t('lobe-gtd.createPlan.goal.placeholder')}
          style={{ padding: 0, resize: 'none' }}
          value={goal}
          variant={'borderless'}
          onChange={(e) => handleGoalChange(e.target.value)}
          onKeyDown={handleGoalKeyDown}
        />

        {/* Description - Subtitle */}
        <TextArea
          autoSize={{ minRows: 1 }}
          className={styles.description}
          data-testid="plan-description"
          placeholder={t('lobe-gtd.createPlan.description.placeholder')}
          style={{ padding: 0, resize: 'none' }}
          value={description}
          variant={'borderless'}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          onKeyDown={handleDescriptionKeyDown}
        />

        {/* Context - Rich Text Editor */}
        <div style={{ marginTop: 8, minHeight: 200 }}>
          <Editor
            content={args.context}
            editor={editor}
            lineEmptyPlaceholder={t('lobe-gtd.createPlan.context.placeholder')}
            placeholder={t('lobe-gtd.createPlan.context.placeholder')}
            type={'text'}
            plugins={[
              ReactListPlugin,
              ReactCodePlugin,
              ReactCodeblockPlugin,
              ReactHRPlugin,
              ReactLinkPlugin,
              ReactTablePlugin,
              ReactMathPlugin,
            ]}
            style={{
              minHeight: 200,
            }}
            onTextChange={handleContentChange}
          />
        </div>
      </Flexbox>
    );
  },
  isEqual,
);

CreatePlanIntervention.displayName = 'CreatePlanIntervention';

export default CreatePlanIntervention;
