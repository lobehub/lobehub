'use client';

import { type CSSProperties } from 'react';
import { memo } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

export interface AutoSaveHintProps {
  /**
   * Document ID to get save status from DocumentStore
   */
  documentId: string;
  /**
   * Custom styles
   */
  style?: CSSProperties;
}

/**
 * AutoSave hint component that reads from DocumentStore
 * Use this component externally to display save status for a document
 */
const AutoSaveHint = memo<AutoSaveHintProps>(({ documentId, style }) => {
  const saveStatus = useDocumentStore((s) => editorSelectors.saveStatus(documentId)(s));
  const lastUpdatedTime = useDocumentStore(
    (s) => editorSelectors.lastUpdatedTime(documentId)(s) ?? null,
  );

  return (
    <AutoSaveHintBase lastUpdatedTime={lastUpdatedTime} saveStatus={saveStatus} style={style} />
  );
});

AutoSaveHint.displayName = 'AutoSaveHint';

export default AutoSaveHint;
