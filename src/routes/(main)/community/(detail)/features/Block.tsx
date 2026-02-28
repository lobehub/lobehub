import { type FlexboxProps } from '@lobehub/ui';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  more: css`
    display: flex;
    align-items: center;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    margin-block: 0;
    font-size: 16px;
    font-weight: bold;
    line-height: 1.2;
  `,
}));

interface BlockProps extends FlexboxProps {
  more?: string;
  moreLink?: string;
  title: string;
}

const Block = memo<BlockProps>(({ title, more, moreLink, children, ...rest }) => {
  return (
    <Flexbox gap={16} style={{ position: 'relative' }} width={'100%'}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} width={'100%'}>
        <h2 className={styles.title}>{title}</h2>
        {moreLink && (
          <Link target={moreLink.startsWith('http') ? '_blank' : undefined} to={moreLink}>
            <Button className={styles.more} type={'text'}>
              <span>{more}</span>
              <Icon icon={ChevronRight} />
            </Button>
          </Link>
        )}
      </Flexbox>
      <Flexbox {...rest}>{children}</Flexbox>
    </Flexbox>
  );
});

export default Block;
