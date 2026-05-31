import { useQuery } from '@tanstack/react-query';
import { ListAuditLogsRequest, AuditLogsListResponse } from '@/scheme/audit';
import { listAuditLogs } from '@/actions/audit';

/**
 * Audit 로그 목록 조회
 */
export function useAuditLogs(request: ListAuditLogsRequest) {
    return useQuery({
        queryKey: ['audit-logs', request],
        queryFn: () => listAuditLogs(request),
    });
}
