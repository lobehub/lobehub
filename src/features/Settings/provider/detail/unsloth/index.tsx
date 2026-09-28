import { UnslothProviderCard } from 'model-bank/modelProviders';

import ProviderDetail from '../default';
import { CheckError } from './CheckError';

const Page = () => <ProviderDetail {...UnslothProviderCard} checkErrorRender={CheckError} />;

export default Page;
