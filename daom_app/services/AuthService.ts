import 'server-only';

import {
  AccountInfo,
  ConfidentialClientApplication,
  ICachePlugin,
  TokenCacheContext,
} from '@azure/msal-node';
import { NextAuthOptions, Session, getServerSession } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import type { OAuthConfig } from 'next-auth/providers/index';
import * as jose from 'jose';

import MSGraphService from './MSGraphService';
import { getRedisClient } from '@/utils/redis';
import { AUTH_TOKEN_VERSION } from '@/const/auth';
import BaseService from './BaseService';
import CosmosDBService from './CosmosDBService';
import MSFlowService from './MSFlowService';
import { DAOMEnvConfig } from '@/scheme/env';

export interface EntraIDProfile extends Record<string, any> {
  sub: string;
  nickname: string;
  email: string;
  picture: string;
  oid: string;
  account: AccountInfo;
}

export type CurrentUser = {
  name: string;
  oid: string;
  upn: string;
  roles: Session['user']['roles'];
};

export default class AuthService extends BaseService {
  msGraphService: MSGraphService;
  cosmosDBService: CosmosDBService;
  msFlowService: MSFlowService;

  constructor(envConfig: DAOMEnvConfig) {
    super(envConfig);
    this.msGraphService = new MSGraphService(envConfig);
    this.cosmosDBService = new CosmosDBService(envConfig);
    this.msFlowService = new MSFlowService(envConfig);
  }

  private logJwtFootprint(_token: JWT, _phase: string): void {
    // JWT payload footprint 로그는 운영 노이즈로 인해 비활성화
  }

  private normalizeSessionRoles(rawRoles: unknown): NonNullable<Session['user']['roles']> {
    if (!Array.isArray(rawRoles)) return [];
    const roleSet = new Set<NonNullable<Session['user']['roles']>[number]>();
    for (const role of rawRoles) {
      if (typeof role !== 'string') continue;
      if (role === 'DAOM.SuperAdmin' || role === 'SuperAdmin') {
        roleSet.add(role);
      }
    }
    return Array.from(roleSet);
  }

  async getNextAuthOptions() {
    const client = await this.msGraphService.getMSGraphClient();

    let cookies = undefined;

    if (process.env.daom_ENABLE_CROSS_SITE_COOKIE) {
      cookies = {
        sessionToken: {
          name: `__Secure-next-auth.session-token`,
          options: {
            httpOnly: true,
            sameSite: 'None',
            path: '/',
            secure: true,
          },
        },
        callbackUrl: {
          name: `__Secure-next-auth.callback-url`,
          options: {
            sameSite: 'None',
            path: '/',
            secure: true,
          },
        },
        csrfToken: {
          name: `__Host-next-auth.csrf-token`,
          options: {
            httpOnly: true,
            sameSite: 'None',
            path: '/',
            secure: true,
          },
        },
        state: {
          name: `daom-next-auth.state`,
          options: {
            httpOnly: true,
            sameSite: 'None',
            path: '/',
            secure: true,
            maxAge: 900,
          },
        },
      };
    }

    const options: NextAuthOptions = {
      secret: process.env.NEXTAUTH_SECRET,
      session: {
        strategy: 'jwt',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      },
      cookies: cookies,
      // Configure one or more authentication providers
      providers: [await this.getNextAuthEntraIDProvider()],
      callbacks: {
        jwt: async ({ token, account, profile }) => {
          // 기존 세션 쿠키에 남아있는 대형 access_token을 강제로 제거해 JWT footprint를 줄인다.
          if ('access_token' in token) {
            delete token.access_token;
          }

          if (account) {
            token.expires_at = account.expires_at;
            this.logJwtFootprint(token, 'account-set');
          }

          if (profile) {
            token.oid = profile.oid;
            token.roles = this.normalizeSessionRoles(profile.roles);
            const user = await client.api(`/users/${token.oid}`).get();
            token.upn = user.userPrincipalName;
            token.roles = this.normalizeSessionRoles(token.roles);
            this.logJwtFootprint(token, 'profile-set');
          }

          if (!token.version) {
            token.version = AUTH_TOKEN_VERSION;
          }

          const now = Math.floor(Date.now() / 1000);

          const bufferSeconds = 60 * 15;

          // 액세스 토큰이 만료 임박(15분 이내)이면 갱신 시도
          if (token.expires_at && token.expires_at - bufferSeconds <= now) {
            try {
              if (!token.oid) {
                throw new Error('Broken session?');
              }

              const msalClient = await this.getMSALClient({
                envId: this.envConfig.id,
                accountId: token.oid,
              });

              const accountInfo = await msalClient
                .getTokenCache()
                .getAccountByLocalId(token.oid);

              if (!accountInfo) {
                throw new Error(
                  'Account Cache not found in cache, please log in again.',
                );
              }

              const scopes = await this.getAuthScopes([
                'User.Read',
              ]);

              const acquiredToken = await msalClient.acquireTokenSilent({
                scopes: scopes,
                account: accountInfo,
                forceRefresh: true,
              });

              token.error = undefined; // 갱신 성공 시 에러 초기화

              if (acquiredToken.expiresOn) {
                token.expires_at = acquiredToken.expiresOn.getTime() / 1000;
              }
              this.logJwtFootprint(token, 'refresh-success');
            } catch (e) {
              // 토큰 갱신 실패해도 throw 하지 않고 기존 세션 유지
              // 세션을 강제 종료하지 않음 - 사용자는 계속 로그인 상태 유지
              console.warn('[AuthService] 토큰 갱신 실패. 기존 세션 유지:', e instanceof Error ? e.message : e);
              token.error = 'RefreshAccessTokenError';
            }
          }

          this.logJwtFootprint(token, 'jwt-return');

          return token;
        },
        session: async ({ session, token }) => {
          session.user.oid = token.oid;
          session.user.upn = token.upn;
          session.user.roles = token.roles;
          session.error = token.error;

          return session;
        },
      },
      pages: {
        signIn: '/auth/login',
      },
    };

    return options;
  }

  async getSession() {
    const session = await getServerSession(await this.getNextAuthOptions());
    return session;
  }

  async getCurrentUser(): Promise<CurrentUser | undefined> {
    const session = await this.getSession();
    if (session?.user && session?.user?.name && session?.user?.oid && session?.user?.upn) {
      return {
        name: session.user.name,
        oid: session.user.oid,
        upn: session.user.upn,
        roles: session.user.roles ?? []
      }
    }

  }

  /**
   * Bearer 토큰(MS Entra ID) 검증 및 사용자 정보 추출
   */
  async verifyAccessToken(token: string, extUser?: string): Promise<CurrentUser | undefined> {
    try {
      // 1. APIM/Connector 전용 고정 보안 키(Shared Secret) 검증
      const connectorKey = (this.envConfig as any).connector_api_key;
      if (connectorKey && token === connectorKey) {
        // 이메일 헤더(extUser)가 제공된 경우: 실사용자 매핑 및 미등록자 차단
        if (extUser) {
          try {
            const client = await this.msGraphService.getMSGraphClient();
            const response = await client
              .api('/users')
              .filter(`mail eq '${extUser}' or userPrincipalName eq '${extUser}'`)
              .select('id,displayName,mail,userPrincipalName')
              .get();

            const user = response.value?.[0];
            if (!user) {
              console.warn(`[AuthService] Connector User not found in directory: ${extUser}. Blocking.`);
              return undefined;
            }

            console.log(`[AuthService] Connector Auth Success (Identified): ${user.displayName} (${user.userPrincipalName})`);
            return {
              name: user.displayName,
              oid: user.id,
              upn: user.userPrincipalName || user.mail || extUser,
              roles: ['DAOM.Connector' as any] 
            };
          } catch (err) {
            console.error(`[AuthService] MS Graph User lookup failed:`, err);
            return undefined;
          }
        }

        // 이메일 헤더(extUser)가 없는 경우: 범용 시스템 사용자(System)로 인증 허용
        console.log(`[AuthService] Connector Auth Success (System): Anonymous APIM Call`);
        return {
          name: 'APIM Connector',
          oid: '00000000-0000-0000-0000-000000000000',
          upn: 'apim-connector@system',
          roles: ['DAOM.Connector' as any]
        };
      }

      const tenantId = this.envConfig.azure_ad.tenant_id;
      const clientId = this.envConfig.azure_ad.client_id;

      // 디버깅을 위해 토큰 검증 전 클레임 살짝 확인
      const decoded = jose.decodeJwt(token);


      // MS Entra ID JWKS 엔드포인트
      const JWKS = jose.createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
      );

      // 토건 검증 (서명, 만료시간 확인)
      const { payload } = await jose.jwtVerify(token, JWKS);

      // 발행자(Issuer) 수동 검증 (v1.0 & v2.0)
      const allowedIssuers = [
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
        `https://sts.windows.net/${tenantId}/`
      ];
      if (!allowedIssuers.includes(payload.iss || '')) {
        console.warn(`[AuthService] Invalid Issuer: ${payload.iss}`);
        return undefined;
      }

      // 대상(Audience) 수동 검증
      /**
       * ⚠️ Audience(대상) 불일치 확인
       * 현재 코드에 하드코딩된 'api://4f34b853-9a23-4633-8e71-86ce4376369a'는 로그에서 확인된 값이지만, 이 프로젝트의 기본 client_id와 다릅니다.
       * 질문: 이 ID가 현재 작업 중인 Azure 앱 등록(App Registration)의 'API 노출(Expose an API)' 탭에 설정된 Application ID URI가 맞으신가요?
       * 위험 요소: 만약 이 ID가 우리 테넌트 내의 전혀 다른 앱(예: 인사 시스템 등)의 ID라면, 다른 앱을 쓰기 위해 받은 토큰으로 우리 시스템에 들어오는 'Audience Confusion' 공격이 가능해집니다.
       * 권장: 이 값이 현재 앱의 고유 URI가 맞는지 꼭 확인하시고, 가급적 env.development.json 등에 설정값으로 빼서 관리하는 것이 좋습니다.
       */

      const allowedAudiences = [
        clientId,
        `api://${clientId}`,
        `spn:${clientId}`
        //'api://4f34b853-9a23-4633-8e71-86ce4376369a',//임시용 지워야함
        //'4f34b853-9a23-4633-8e71-86ce4376369a'//임시용 지워야함
      ];

      const payloadAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const isAudValid = payloadAud.some(aud => allowedAudiences.includes(aud || ''));

      if (!isAudValid) {
        console.warn(`[AuthService] Invalid Audience: ${JSON.stringify(payload.aud)}`);
        return undefined;
      }

      if (payload && payload.oid) {
        // 앱 전용 토큰(Client Credentials)은 name 대신 appid_displayname 등을 사용하기도 함
        const name = (payload.name as string) ||
          (payload.appid_displayname as string) ||
          (payload.preferred_username as string) ||
          'External System';

        return {
          name,
          oid: payload.oid as string,
          upn: (payload.upn as string) || (payload.preferred_username as string) || (name),
          roles: (payload.roles as any[]) || []
        };
      }
    } catch (error) {
      console.error('[AuthService] Token verification failed:', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  async getMSALClient(cacheOption?: CacheOption) {
    let cachePlugin = undefined;

    if (cacheOption) {
      cachePlugin = new RedisCachePlugin(cacheOption);
    }

    return new ConfidentialClientApplication({
      auth: {
        clientId: this.envConfig.azure_ad.client_id,
        authority: `https://login.microsoftonline.com/${this.envConfig.azure_ad.tenant_id}`,
        clientCertificate: {
          thumbprint: this.envConfig.azure_ad.cert_thumbprint, // a 40-digit hexadecimal string
          privateKey: this.envConfig.azure_ad.pem_key,
        },
      },
      cache: {
        cachePlugin,
      }
    });
  }

  async getAuthScopes(etcScopes: string[]) {
    const scopes = [
      'offline_access',
      'openid',
      'profile',
      'email',
      ...etcScopes,
    ];
    return scopes;
  }

  async getNextAuthEntraIDProvider<P extends EntraIDProfile>() {
    const scopes = await this.getAuthScopes([
      'User.Read',
    ]);

    const tenant = this.envConfig.azure_ad.tenant_id;

    const provider: OAuthConfig<P> = {
      id: 'azure-ad',
      name: 'Azure Active Directory',
      type: 'oauth',
      wellKnown: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration?appid=${this.envConfig.azure_ad.client_id}`,
      authorization: {
        params: {
          scope: scopes.join(' '),
        },
      },
      token: {
        request: async (context) => {
          const cca = await this.getMSALClient();

          try {


            const r = await cca.acquireTokenByCode({
              code: context.params.code as string,
              scopes: scopes,
              redirectUri: context.provider.callbackUrl,
            });



            const oid = r.account?.localAccountId;

            if (oid && r.expiresOn) {
              const option = {
                envId: this.envConfig.id,
                accountId: oid,
              }

              const clientForCache = await this.getMSALClient(option);
              const cache = cca.getTokenCache().serialize();
              clientForCache.getTokenCache().deserialize(cache);
              // 항상 최신 갱신된 Access/Refresh Token 캐시로 Redis 덮어쓰기 (기존 버그 원인)
              await setSessionCache(option, cache);
              await clientForCache.getTokenCache().getAllAccounts();
            }

            return {
              tokens: {
                token_type: r.tokenType,
                id_token: r.idToken,
                access_token: r.accessToken,
                scope: r.scopes.join(' '),
                expires_at: (r.expiresOn?.getTime() ?? 0) / 1000,
                session_state: r.state,
              },
            };
          } catch (error) {
            console.error('[DEBUG] Token acquisition failed:', error);
            throw error;
          }
        },
      },
      profile: async (profile) => {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
        };
      },
      style: { logo: '/azure.svg', text: '#fff', bg: '#0072c6' },
      clientId: this.envConfig.azure_ad.client_id,
      clientSecret: '',
    };

    return provider;
  }
}

interface CacheOption {
  envId: string;
  accountId: string;
}

class RedisCachePlugin implements ICachePlugin {
  private option: CacheOption;

  constructor(option: CacheOption) {
    this.option = option;
  }

  async beforeCacheAccess(tokenCacheContext: TokenCacheContext) {
    const cache = await getSessionCache(this.option);
    if (cache) {
      tokenCacheContext.cache.deserialize(cache);
    }
  }

  async afterCacheAccess(tokenCacheContext: TokenCacheContext) {
    if (tokenCacheContext.cacheHasChanged) {
      const cache = tokenCacheContext.cache.serialize();
      await setSessionCache(this.option, cache)
    }
  }
}

async function getSessionCache(option: CacheOption) {
  const redisClient = getRedisClient();
  const cache = await redisClient.get(
    `@daom_app/${option.envId}/session-cache/${option.accountId}`,
  );
  // console.log(cache);
  return cache
}

async function setSessionCache(option: CacheOption, cache: string) {
  const redisClient = getRedisClient();
  await redisClient.set(
    `@daom_app/${option.envId}/session-cache/${option.accountId}`,
    cache,
    'EX',
    60 * 60 * 24 * 90, // 90 days
  );
}
