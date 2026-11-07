'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileTextIcon, FolderIcon, HomeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { describeDocumentRef } from './describeDocumentRef';
import type { AgentDocumentLookup } from './useAgentDocumentLookup';

const styles = stylex.create({
  icon: { flex: 'none', color: cssVar.colorTextDescription },
  id: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px' },
});

interface DocumentRefProps {
  /** Title to show when the id no longer resolves (e.g. from a tool result). */
  fallbackTitle?: string;
  lookup: AgentDocumentLookup;
  /** A document/folder id, or null/undefined for the root. */
  refId?: string | null;
  strong?: boolean;
}

/** One document, folder or the root, shown as the user knows it: glyph + title. */
const DocumentRef = memo<DocumentRefProps>(({ fallbackTitle, lookup, refId, strong }) => {
  const { t } = useTranslation('plugin');
  const view = describeDocumentRef(lookup, refId, fallbackTitle);

  if (view.kind === 'unknown') {
    return (
      <Text className={stylex.props(styles.id).className} type={'secondary'}>
        {t('builtins.lobe-agent-documents.ref.unknown', { id: view.id })}
      </Text>
    );
  }

  const icon = view.kind === 'root' ? HomeIcon : view.kind === 'folder' ? FolderIcon : FileTextIcon;
  const title = view.kind === 'root' ? t('builtins.lobe-agent-documents.ref.root') : view.title;

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
      <Icon className={stylex.props(styles.icon).className} icon={icon} size={14} />
      <Text ellipsis strong={strong}>
        {title}
      </Text>
    </Flexbox>
  );
});

DocumentRef.displayName = 'AgentDocumentRef';

export default DocumentRef;
