import { Button, Checkbox, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { BookMinusIcon, BookPlusIcon, FileBoxIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';

const styles = createStaticStyles(({ css }) => ({
  total: css`
    cursor: pointer;
    height: 27px;
  `,
}));

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'moveToOtherKnowledgeBase'
  | 'batchChunking'
  | 'delete'
  | 'deleteLibrary'
  | 'removeFromKnowledgeBase';

interface MultiSelectActionsProps {
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  onClickCheckbox: () => void;
  selectCount: number;
  total?: number;
}

const MultiSelectActions = memo<MultiSelectActionsProps>(
  ({ selectCount, total, onActionClick, onClickCheckbox }) => {
    const { t } = useTranslation(['components', 'common']);

    const isSelectedFiles = selectCount > 0;
    const { modal, message } = App.useApp();

    const libraryId = useResourceManagerStore((s) => s.libraryId);

    return (
      <Flexbox
        align={'center'}
        gap={12}
        horizontal
        style={{
          borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
          height: 40,
          paddingBlockEnd: 12,
        }}
      >
        <Flexbox
          align={'center'}
          className={styles.total}
          gap={8}
          horizontal
          onClick={onClickCheckbox}
          paddingInline={4}
        >
          <Checkbox
            checked={selectCount === total}
            indeterminate={isSelectedFiles && selectCount !== total}
          />
          {typeof total === 'undefined' ? (
            <Skeleton
              active
              paragraph={{ rows: 1, style: { marginBottom: 0, width: 60 }, width: '100%' }}
              title={false}
            />
          ) : (
            <div style={{ height: 18 }}>
              {isSelectedFiles
                ? t('FileManager.total.selectedCount', { count: selectCount })
                : t('FileManager.total.fileCount', { count: total })}
            </div>
          )}
        </Flexbox>
        {isSelectedFiles && (
          <Flexbox gap={8} horizontal>
            {libraryId ? (
              <>
                <Button
                  icon={BookMinusIcon}
                  onClick={() => {
                    modal.confirm({
                      okButtonProps: {
                        danger: true,
                      },
                      onOk: async () => {
                        await onActionClick('removeFromKnowledgeBase');
                        message.success(t('FileManager.actions.removeFromLibrarySuccess'));
                      },
                      title: t('FileManager.actions.confirmRemoveFromLibrary', {
                        count: selectCount,
                      }),
                    });
                  }}
                  size={'small'}
                >
                  {t('FileManager.actions.removeFromLibrary')}
                </Button>
                <Button
                  color={'default'}
                  icon={<Icon icon={BookPlusIcon} />}
                  onClick={() => {
                    onActionClick('moveToOtherKnowledgeBase');
                  }}
                  size={'small'}
                  variant={'filled'}
                >
                  {t('FileManager.actions.moveToOtherLibrary')}
                </Button>
              </>
            ) : (
              <Button
                color={'default'}
                icon={<Icon icon={BookPlusIcon} />}
                onClick={() => {
                  onActionClick('addToKnowledgeBase');
                }}
                size={'small'}
                variant={'filled'}
              >
                {t('FileManager.actions.addToLibrary')}
              </Button>
            )}
            <Button
              color={'default'}
              icon={<Icon icon={FileBoxIcon} />}
              onClick={async () => {
                await onActionClick('batchChunking');
              }}
              size={'small'}
              variant={'filled'}
            >
              {t('FileManager.actions.batchChunking')}
            </Button>
            <Button
              color={'danger'}
              danger
              icon={<Icon icon={Trash2Icon} />}
              onClick={async () => {
                modal.confirm({
                  okButtonProps: {
                    danger: true,
                  },
                  onOk: async () => {
                    await onActionClick('delete');
                    message.success(t('FileManager.actions.deleteSuccess'));
                  },
                  title: t('FileManager.actions.confirmDeleteMultiFiles', { count: selectCount }),
                });
              }}
              size={'small'}
              variant={'filled'}
            >
              {t('delete', { ns: 'common' })}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default MultiSelectActions;
