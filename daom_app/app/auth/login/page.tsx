import { redirect } from 'next/navigation';
import LoginComponent from '@/components/auth/LoginComponent';
import AuthService from '@/services/AuthService';
import { getCurrentEnvConfig } from '@/lib/env';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
  }>;
}) {
  const _searchParams = await searchParams;

  const envConfig = await getCurrentEnvConfig();
  const authService = new AuthService(envConfig);
  const session = await authService.getSession();
  if (session) {
    redirect(_searchParams.callbackUrl ?? '/');
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background">
      <LoginComponent />
    </div>
  );
}
