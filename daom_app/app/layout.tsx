import type { Metadata } from "next";
import { spoqa } from '@/styles/fonts';
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import AuthService from "@/services/AuthService";
import Providers from "@/components/providers";
import { getAppConfig, getSiteConfig } from "@/actions/env";
import { getQueryClient } from "@/lib/reactQuery";
import { siteConfigQueryOptions } from "@/queries/env";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getCurrentEnvConfig } from "@/lib/env";

export async function generateMetadata() {
  const siteConfig = await getSiteConfig();
  const metadata: Metadata = {
    title: siteConfig.app_name ?? "DAOM",
    description: '문서 번역 서비스',
  };

  if (siteConfig.app_favicon?.src) {
    // If it's the old default, use the new default
    if (siteConfig.app_favicon.src === '/favicon.ico') {
      metadata.icons = '/icon.png';
    } else {
      metadata.icons = siteConfig.app_favicon.src;
    }
  }

  return metadata;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const envConfig = await getCurrentEnvConfig();
  const authService = new AuthService(envConfig);
  const session = await authService.getSession();

  return (
    <html lang="ko" className={spoqa.variable} suppressHydrationWarning>
      <body
        className={`antialiased`}
      >
        <Providers session={session}>
          <Toaster />
          <SiteConfigWrapper>
            {children}
          </SiteConfigWrapper>
        </Providers>
      </body>
    </html>
  );
}

async function SiteConfigWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const appConfig = queryClient.setQueryData(
    siteConfigQueryOptions.queryKey,
    await getAppConfig(),
  );
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
