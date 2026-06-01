'use client';

import * as React from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { Session } from 'next-auth';
import { getQueryClient } from '@/lib/reactQuery';
import { ThemeProvider } from 'next-themes';
import { SiteConfigThemeProvider } from './providers/SiteConfigThemeProvider';
import { RouteProgressBar } from '@/components/common/RouteProgressBar';
import { useSession, signIn } from 'next-auth/react';
// import { Provider as JotaiProvider } from 'jotai';

function SessionErrorHandler() {
  const { data: session } = useSession();

  React.useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      signIn('azure-ad'); // Force sign-in
    }
  }, [session]);

  return null;
}

interface ProvidersProps {
  children: React.ReactNode;
  session: Session | null;
}

export default function Providers({ children, session }: ProvidersProps) {
  const [queryClient] = React.useState(() => getQueryClient());

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          refetchInterval={15 * 60}
          refetchOnWindowFocus={true}
          session={session}
        >
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <SiteConfigThemeProvider>
              <SessionErrorHandler />
              <RouteProgressBar />
              {children}
            </SiteConfigThemeProvider>
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
