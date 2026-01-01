import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import ClientMode from './ClientMode';
import ProviderDetail from './index';

const ProviderDetialPage = (props: { id?: string | null }) => {
  const { id } = props;

  const builtinProviderCard = DEFAULT_MODEL_PROVIDER_LIST.find((v) => v.id === id);
  // if builtin provider
  if (!!builtinProviderCard) return <ProviderDetail source={'builtin'} {...builtinProviderCard} />;

  if (id) {
    return <ClientMode id={id} />;
  }
  return null;
};

export default ProviderDetialPage;
