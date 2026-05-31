import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useMemo } from 'react';
import { getAppConfig, updateSiteConfigAction } from '@/actions/env';
import { SiteConfig } from '@/scheme/siteConfig';

export type AppConfig = Awaited<ReturnType<typeof getAppConfig>> & {
  features?: {
    multifile_upload?: boolean;
    meta_prompt?: boolean;
  };
};

const DEFAULT_APP_CONFIG: AppConfig = {
  id: '',
  site_config: SiteConfig.parse({}),
  features: {
    multifile_upload: false,
    meta_prompt: false,
  },
  is_dev_mode: false,
};

export const siteConfigQueryOptions = queryOptions<AppConfig>({
  queryKey: ['_next', '/app_config'],
  queryFn: async () => {
    const config = await getAppConfig();
    return {
      ...config,
      features: {
        multifile_upload: config.features?.multifile_upload === true,
        meta_prompt: config.features?.meta_prompt === true,
      },
    };
  },
  initialData: DEFAULT_APP_CONFIG,
  staleTime: 0,
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchInterval: false,
});

export function useSiteConfig() {
  const options = useMemo(
    () => ({
      ...siteConfigQueryOptions,
      select: (config: AppConfig) => {
        return {
          ...config.site_config,
        }
      },
    }),
    []
  );
  return useQuery(options);
}

export function useDevMode() {
  const options = useMemo(
    () => ({
      ...siteConfigQueryOptions,
      select: (config: AppConfig) => config.is_dev_mode,
    }),
    []
  );
  return useQuery(options);
}

export function useEnvId() {
  const options = useMemo(
    () => ({
      ...siteConfigQueryOptions,
      select: (config: AppConfig) => config.id,
    }),
    []
  );
  return useQuery(options);
}

export function useMultifileUploadFeature() {
  const options = useMemo(
    () => ({
      ...siteConfigQueryOptions,
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      select: (config: AppConfig) => config.features?.multifile_upload === true,
    }),
    []
  );
  return useQuery(options);
}

export function useMetaPromptFeature() {
  const options = useMemo(
    () => ({
      ...siteConfigQueryOptions,
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      select: (config: AppConfig) => config.features?.meta_prompt === true,
    }),
    []
  );
  return useQuery(options);
}

export function useUpdateSiteConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => updateSiteConfigAction(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['_next', '/app_config'] });
    },
  });
}
