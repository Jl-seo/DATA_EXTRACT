import { useQuery } from '@tanstack/react-query';
import { getDashboardStats } from '@/actions/audit';

export function useDashboardStats(days: number = 7) {
    return useQuery({
        queryKey: ['dashboard-stats', days],
        queryFn: async () => {
            return await getDashboardStats(days);
        },
        refetchInterval: 30000, // 30초마다 자동 갱신
    });
}
