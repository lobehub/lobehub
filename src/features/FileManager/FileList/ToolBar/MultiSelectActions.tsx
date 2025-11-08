import { Button, Icon } from '@lobehub/ui';
import { App, Checkbox, Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { BookMinusIcon, BookPlusIcon, FileBoxIcon, Trash2Icon } from 'lucide-react';
import { rgba } from 'polished';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  container: css`
    height: 40px;
    padding-block-end: 12px;
    border-block-end: 1px solid ${isDarkMode ? token.colorSplit : rgba(token.colorSplit, 0.06)};
  `,
  total: css`
    cursor: pointer;
    height: 27px;
  `,
}));

export type MultiSelectActionType =
  | 'addToKnowledgeBase'
  | 'delete'
  | 'batchChunking'
  | 'removeFromKnowledgeBase'
  | 'addToOtherKnowledgeBase';

interface MultiSelectActionsProps {
  isInKnowledgeBase?: boolean;
  onActionClick: (type: MultiSelectActionType) => Promise<void>;
  onClickCheckbox: () => void;
  selectCount: number;
  total?: number;
}

const MultiSelectActions = memo<MultiSelectActionsProps>(
  ({ selectCount, isInKnowledgeBase, total, onActionClick, onClickCheckbox }) => {
    const { t } = useTranslation(['components', 'common']);
    const { styles } = useStyles();

    const isSelectedFiles = selectCount > 0;
    const { modal, message } = App.useApp();
    return (
      <Flexbox align={'center'} gap={12} horizontal>
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
            {isInKnowledgeBase ? (
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
                        message.success(t('FileManager.actions.removeFromKnowledgeBaseSuccess'));
                      },
                      title: t('FileManager.actions.confirmRemoveFromKnowledgeBase', {
                        count: selectCount,
                      }),
                    });
                  }}
                  size={'small'}
                >
                  {t('FileManager.actions.removeFromKnowledgeBase')}
                </Button>
                <Button
                  color={'default'}
                  icon={<Icon icon={BookPlusIcon} />}
                  onClick={() => {
                    onActionClick('addToOtherKnowledgeBase');
                  }}
                  size={'small'}
                  variant={'filled'}
                >
                  {t('FileManager.actions.addToOtherKnowledgeBase')}
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
                {t('FileManager.actions.addToKnowledgeBase')}
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
