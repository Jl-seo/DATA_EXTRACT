import 'server-only';
import { ClientCertificateCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import BaseService from './BaseService';

export default class MSFlowService extends BaseService {
  async getMSFlowAuthProvider(scope?: string) {
    const credential = new ClientCertificateCredential(
      this.envConfig.azure_ad.tenant_id,
      this.envConfig.azure_ad.client_id,
      {
        certificate: this.envConfig.azure_ad.pem_key,
      },
    );

    const targetScope = scope || 'https://service.flow.microsoft.com/.default';


    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: [targetScope],
    });

    return authProvider;
  }

  async getMSFlowAuthToken(scope?: string) {

    const authProvider = await this.getMSFlowAuthProvider(scope);
    const token = await authProvider.getAccessToken();

    return token;
  }
}
