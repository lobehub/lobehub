import { clientOnlyRoute } from '../components/clientOnlyRoute';

export default clientOnlyRoute(() => import('../components/agentDocReader.client'));
