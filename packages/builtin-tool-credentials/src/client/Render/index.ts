import { CredentialsApiName } from '../../types';
import OpenManagerCard from './OpenManagerCard';

export const CredentialsRenders = {
  [CredentialsApiName.deleteCredential]: OpenManagerCard,
  [CredentialsApiName.getCredential]: OpenManagerCard,
  [CredentialsApiName.listCredentials]: OpenManagerCard,
  [CredentialsApiName.setCredential]: OpenManagerCard,
};

export { OpenManagerCard };
