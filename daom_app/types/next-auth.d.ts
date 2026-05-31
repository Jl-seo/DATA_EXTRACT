import { DefaultSession } from 'next-auth';


type TUserRole = 'DAOM.SuperAdmin' | 'DAOM.Connector' | 'SuperAdmin';

type UserRole = TUserRole;

declare module 'next-auth' {
  interface Session {
    user: {
      oid?: string;
      upn?: string;
      access_token?: string;
      roles?: UserRole[];
    } & DefaultSession['user'];
    error?: 'RefreshAccessTokenError';
  }

  interface Profile {
    oid?: string;
    roles?: UserRole[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    oid?: string;
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    upn?: string;
    version?: string;
    roles?: UserRole[];
    error?: 'RefreshAccessTokenError'; // 토큰 갱신 실패 시 세션을 죽이지 않고 에러 마킹
  }
}
