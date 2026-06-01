import 'server-only';
import { ClientCertificateCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import PermissionService from './PermissionService';
import AuthService from './AuthService';
import BaseService from './BaseService';

export default class MSGraphService extends BaseService {
  async getMSGraphClient() {
    const credential = new ClientCertificateCredential(
      this.envConfig.azure_ad.tenant_id,
      this.envConfig.azure_ad.client_id,
      {
        certificate: this.envConfig.azure_ad.pem_key,
      },
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      // The client credentials flow requires that you request the
      // /.default scope, and pre-configure your permissions on the
      // app registration in Azure. An administrator must grant consent
      // to those permissions beforehand.
      scopes: ['https://graph.microsoft.com/.default'],
    });

    return Client.initWithMiddleware({
      authProvider: authProvider,
    });
  }

  // user delegated 전용 graph client
  async getDelegatedGraphClient() {
    const authService = new AuthService(this.envConfig);
    const permissionService = new PermissionService(this.envConfig);
    const me = await permissionService.getCurrentUser();
    if (!me) {
      throw new Error('User Not Found.');
    }

    const oid = me.oid;
    const msalClient = await authService.getMSALClient({
      envId: this.envConfig.id,
      accountId: oid
    });

    const account = await msalClient
      .getTokenCache()
      .getAccountByLocalId(oid);

    if (!account) {
      throw new Error('MS Account Not Found');
    }

    const accessToken = await msalClient.acquireTokenSilent({
      account: account,
      scopes: ['User.Read', 'Files.ReadWrite'],
    });

    if (!accessToken) {
      throw new Error('Access Token Error');
    }

    const graphClient = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => accessToken.accessToken,
      },
    });
    return graphClient;
  }
}
