import { formatSize } from '@lobechat/utils/format';
import { createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { LockIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import KnowledgeIcon from '@/components/KnowledgeIcon';
import { buildFilePath, buildLibraryPath } from '@/features/ResourceManager/utils/resourcePath';
import { useInterfaceDensity } from '@/styles/density';
import { densityVars } from '@/styles/densityVars';
import { type KnowledgeItem, KnowledgeType } from '@/types/knowledgeBase';

import Actions from './Action';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    margin: 0 !important;
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextDescription};
  `,
  link: css`
    overflow: hidden;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
      text-decoration: underline;
    }
  `,
  title: css`
    margin: 0 !important;
    font-size: ${densityVars.fontSize};
    line-height: 1;
  `,
}));

interface PluginItemProps extends KnowledgeItem {
  action?: ReactNode;
}

const PluginItem = memo<PluginItemProps>(
  ({
    action,
    id,
    fileType,
    name,
    type,
    description,
    enabled,
    memberRestricted,
    size,
    updatedAt,
    visibility,
  }) => {
    const activeWorkspaceSlug = useActiveWorkspaceSlug();
    const isLibrary = type === KnowledgeType.KnowledgeBase;
    // The name is the way into the library or file, so it opens it in a new tab.
    const detailPath = isLibrary
      ? buildLibraryPath(id, activeWorkspaceSlug)
      : buildFilePath(id, activeWorkspaceSlug);
    // Files carry no description; their size and last change tell similar documents apart.
    const meta = isLibrary
      ? description
      : [
          size ? formatSize(size) : undefined,
          updatedAt ? dayjs(updatedAt).format('YYYY-MM-DD') : undefined,
        ]
          .filter(Boolean)
          .join(' · ');

    const compact = useInterfaceDensity() === 'compact';
    const iconSize = compact ? 28 : 40;

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        justify={'space-between'}
        paddingBlock={compact ? 6 : 12}
        paddingInline={16}
        style={{ position: 'relative' }}
      >
        <Flexbox
          horizontal
          align={'center'}
          flex={1}
          gap={8}
          style={{ overflow: 'hidden', position: 'relative' }}
        >
          <KnowledgeIcon
            fileType={fileType}
            locked={memberRestricted}
            name={name}
            size={{ file: iconSize, repo: iconSize }}
            type={type}
          />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden', position: 'relative' }}>
            <Flexbox horizontal align={'center'} gap={6}>
              {visibility === 'private' && (
                <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={12} />
              )}
              <a
                className={styles.link}
                href={detailPath}
                rel={'noreferrer'}
                target={'_blank'}
                title={name}
              >
                <Text ellipsis className={styles.title}>
                  {name}
                </Text>
              </a>
            </Flexbox>
            {meta && (
              <Text ellipsis className={styles.desc}>
                {meta}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        {action === undefined ? <Actions enabled={enabled} id={id} type={type} /> : action}
      </Flexbox>
    );
  },
);

export default PluginItem;
