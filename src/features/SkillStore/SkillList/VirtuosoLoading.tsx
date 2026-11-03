import { Center, cssVar, Spin } from '@lobehub/ui';

const VirtuosoLoading = () => {
  return (
    <Center padding={16}>
      <Spin size="small" style={{ color: cssVar.colorTextDescription }} />
    </Center>
  );
};

export default VirtuosoLoading;
