import { Block, Center, Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCwIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';

import UploadDetail from '../../../components/UploadDetail';
import Content from './Content';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    position: absolute;
    z-index: 10;
    inset-block-start: -4px;
    inset-inline-end: -4px;

    border-radius: 5px;

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 0 0 0.5px ${cssVar.colorFillSecondary} inset,
      ${cssVar.boxShadowTertiary};
  `,
  container: css`
    user-select: none;

    position: relative;

    width: 180px;
    height: 64px;
    border-radius: 8px;
  `,
  image: css`
    margin-block: 0 !important;
  `,
}));

type FileItemProps = UploadFileItem;

const FileItem = memo<FileItemProps>((props) => {
  const { error, errorCode, file, uploadState, status, id, tasks } = props;
  const { t } = useTranslation(['chat', 'common']);
  const [removeChatUploadFile, retryChatUploadFile] = useFileStore((s) => [
    s.removeChatUploadFile,
    s.retryChatUploadFile,
  ]);

  return (
    <Block horizontal align={'center'} className={styles.container} variant={'outlined'}>
      <Center flex={1} height={64} padding={4} style={{ maxWidth: 64 }}>
        <Content {...props} />
      </Center>
      <Flexbox flex={1} gap={4} style={{ paddingBottom: 4, paddingInline: 4 }}>
        <Text
          style={{ fontSize: 12, maxWidth: 88 }}
          ellipsis={{
            tooltip: file.name,
          }}
        >
          {file.name}
        </Text>
        <UploadDetail
          error={error}
          size={file.size}
          status={status}
          tasks={tasks}
          uploadState={uploadState}
        />
      </Flexbox>
      <Flexbox horizontal className={styles.actions}>
        {status === 'error' && errorCode ? (
          <FileUploadErrorActions compact code={errorCode} />
        ) : status === 'error' ? (
          <ActionIcon
            icon={RotateCwIcon}
            size={'small'}
            title={t('retry', { ns: 'common' })}
            onClick={() => {
              void retryChatUploadFile(id);
            }}
          />
        ) : null}
        <ActionIcon
          color={'red'}
          icon={Trash2Icon}
          size={'small'}
          title={t('delete', { ns: 'common' })}
          onClick={() => {
            void removeChatUploadFile(id);
          }}
        />
      </Flexbox>
    </Block>
  );
});

export default FileItem;
