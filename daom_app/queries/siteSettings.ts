import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SiteConfig, UpdateSiteConfigRequest } from '@/scheme/siteSettings';
import { getSiteConfig, updateSiteConfig, resetSiteConfig } from '@/actions/siteSettings';

/**
 * Site Configuration 조회
 */
export function useSiteConfig() {
    return useQuery({
        queryKey: ['settings', 'site'],
        queryFn: () => getSiteConfig(),
        staleTime: 1000 * 60 * 5, // 5분
    });
}

/**
 * Site Configuration 업데이트
 */
export function useUpdateSiteConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateSiteConfigRequest) => updateSiteConfig(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings', 'site'] });
        },
    });
}

/**
 * Site Configuration 초기화
 */
export function useResetSiteConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => resetSiteConfig(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings', 'site'] });
        },
    });
}
