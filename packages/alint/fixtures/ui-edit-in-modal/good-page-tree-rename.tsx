// Fixture: rename on a node of the Docs page tree (nested rows, file-manager convention).
import { Icon } from '@lobehub/ui';
import { Input } from '@lobehub/ui/base-ui';
import { FileTextIcon } from 'lucide-react';
import { memo, useState } from 'react';

import NavItem from '@/features/NavPanel/components/NavItem';
import { pageActions, usePageStore } from '@/store/page';

import { buildPageTree } from './tree';

const INDENT_PER_LEVEL = 12;

const PageTreeRow = memo<{ depth: number; id: string; title: string }>(({ depth, id, title }) => {
  const editing = usePageStore((s) => s.renamingPageId === id);
  const [value, setValue] = useState(title);
  const done = () => pageActions.setRenamingPageId(null);

  return (
    <NavItem
      contextMenuItems={[{ key: 'rename', onClick: () => pageActions.setRenamingPageId(id) }]}
      icon={<Icon icon={FileTextIcon} />}
      style={{ paddingInlineStart: 8 + depth * INDENT_PER_LEVEL }}
      title={
        editing ? (
          <Input
            autoFocus
            size={'small'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPressEnter={() => void pageActions.renamePage(id, value).then(done)}
          />
        ) : (
          title
        )
      }
    />
  );
});

export const PageTree = memo<{ docs: Parameters<typeof buildPageTree>[0] }>(({ docs }) => (
  <>
    {buildPageTree(docs).map((node) => (
      <PageTreeRow depth={node.depth} id={node.id} key={node.id} title={node.title} />
    ))}
  </>
));
