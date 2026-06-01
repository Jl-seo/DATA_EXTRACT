// _components/layout/AuthClientWrapper.tsx
'use client';

import { GlobalRole } from '@/services/PermissionService';
import { ModelPermission } from '@/scheme/permission';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '../ui/spinner';

function getLoginRedirectUrl(currentUrl: string) {
  return `/auth/login?callbackUrl=${encodeURIComponent(currentUrl)}`;
}

interface AuthContextType {
  globalRole: GlobalRole;
  modelRoles: ModelPermission[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthClientChecker');
  }
  return context;
}

export default function AuthClientChecker({
  children,
  globalRole,
  modelRoles,
}: {
  children: React.ReactNode;
  globalRole: GlobalRole;
  modelRoles: ModelPermission[];
}) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPath = useMemo(
    () =>
      searchParams.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname,
    [pathname, searchParams],
  );
  const isAllowed = status === 'authenticated' && !!globalRole;

  useEffect(() => {
    // 이미 로딩 중이면 판단 보류
    if (status === 'loading') return;

    // 인증 실패 → 즉시 children 렌더 제거 + redirect
    if (!isAllowed) {
      router.replace(getLoginRedirectUrl(currentPath));
    }
  }, [isAllowed, status, router, currentPath]);

  // 파생 상태로 children 렌더링 제어
  if (!isAllowed) return (<Spinner />);

  return (
    <AuthContext.Provider value={{ globalRole, modelRoles }}>
      {children}
    </AuthContext.Provider>
  );
}
