import { type ButtonProps } from '@lobehub/ui';
import {
  ActionIcon,
  Avatar,
  Button,
  Center,
  CopyButton,
  Flexbox,
  Input,
  Modal,
  Skeleton,
  Tag,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { startCase } from 'es-toolkit/compat';
import { LinkIcon, Share2Icon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useShare } from '@/hooks/useShare';

import CardBanner from '../../components/CardBanner';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    banner: css`
      overflow: hidden;

      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorBgContainer};
      box-shadow: ${cssVar.boxShadowTertiary};
    `,
    copy: css`
      background: ${cssVar.colorPrimary};

      &:hover {
        background: ${cssVar.colorPrimaryHover};
      }
    `,
    icon: css`
      border: 1px solid ${cssVar.colorFillSecondary};

      svg {
        fill: ${cssVar.colorTextSecondary};
      }

      &:hover {
        border: 1px solid ${cssVar.colorBorderSecondary};

        svg {
          fill: ${cssVar.colorText};
        }
      }
    `,
  };
});

interface ShareButtonProps extends ButtonProps {
  meta?: {
    avatar?: string | ReactNode;
    desc?: string;
    hashtags?: string[];
    tags?: ReactNode;
    title?: string;
    url: string;
  };
}

const ShareButton = memo<ShareButtonProps>(({ meta, ...rest }) => {
  const { x, reddit, telegram, whatsapp, mastodon, weibo } = useShare({
    avatar: '',
    desc: '',
    hashtags: [],
    title: '',
    url: '',
    ...meta,
  });
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  let content;

  if (meta) {
    content = (
      <Center gap={16} style={{ position: 'relative' }} width={'100%'}>
        <Flexbox align={'center'} className={styles.banner} width={'100%'}>
          <CardBanner avatar={meta.avatar} size={640} style={{ height: 72, marginBottom: -36 }} />
          <Center
            flex={'none'}
            height={72}
            width={72}
            style={{
              backgroundColor: cssVar.colorBgContainer,
              borderRadius: '50%',
              overflow: 'hidden',
              zIndex: 2,
            }}
          >
            <Avatar animation avatar={meta.avatar} shape={'square'} size={64} />
          </Center>
          <Center padding={12} width={'100%'}>
            <h3 style={{ fontWeight: 'bold', textAlign: 'center' }}>{meta.title}</h3>
            <Text as={'p'} style={{ color: cssVar.colorTextSecondary, textAlign: 'center' }}>
              {meta.desc}
            </Text>
            {meta.hashtags && (
              <Flexbox horizontal align={'center'} gap={4} justify={'center'} wrap={'wrap'}>
                {meta.hashtags.map((tag, index) => (
                  <Tag key={index}>{startCase(tag).trim()}</Tag>
                ))}
              </Flexbox>
            )}
            {meta.tags}
          </Center>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'center'} wrap={'wrap'}>
          {[x, reddit, telegram, whatsapp, mastodon, weibo].map(
            (item) =>
              item.icon && (
                <a href={item.link} key={item.title} rel="noreferrer" target="_blank">
                  <ActionIcon
                    className={styles.icon}
                    icon={item.icon}
                    size={{ blockSize: 36, borderRadius: 18, size: 16 }}
                    title={item.title}
                  />
                </a>
              ),
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} width={'100%'}>
          <Input value={meta.url} variant={'filled'} />
          <CopyButton
            className={styles.copy}
            color={cssVar.colorBgLayout}
            content={meta.url}
            icon={LinkIcon}
            size={{ blockSize: 36, size: 16 }}
          />
        </Flexbox>
      </Center>
    );
  } else {
    content = <Skeleton active paragraph={{ rows: 4 }} title={false} />;
  }

  return (
    <>
      <Button icon={Share2Icon} size={'large'} onClick={() => setOpen(true)} {...rest} />
      <Modal
        footer={null}
        open={open}
        title={t('share')}
        width={360}
        onCancel={() => setOpen(false)}
      >
        {content}
      </Modal>
    </>
  );
});

export default ShareButton;
