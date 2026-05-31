'use client';

import { useState } from 'react';
import { useAuditLogs } from '@/queries/audit';
import { AuditAction, AuditResource } from '@/scheme/audit';
import { Download, Calendar, User, Activity, RefreshCw, Search } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

const actionColors: Record<string, string> = {
    CREATE: 'bg-chart-2/10 text-chart-2',
    READ: 'bg-primary/10 text-primary',
    UPDATE: 'bg-chart-4/10 text-chart-4',
    DELETE: 'bg-destructive/10 text-destructive',
    EXPORT: 'bg-chart-5/10 text-chart-5',
    EXTRACT: 'bg-chart-3/10 text-chart-3',
    WEBHOOK: 'bg-emerald-500/10 text-emerald-600',
    START_EXTRACTION: 'bg-chart-3/10 text-chart-3',
};

export default function AuditLogsPage() {
    const [userId, setUserId] = useState('');
    const [action, setAction] = useState<AuditAction | ''>('');
    const [resourceType, setResourceType] = useState<AuditResource | ''>('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const { data, isLoading, refetch } = useAuditLogs({
        user_id: userId || undefined,
        action: action || undefined,
        resource_type: resourceType || undefined,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        limit: 100,
        offset: 0,
    });

    const getModelInfo = (log: { details?: Record<string, unknown> | null }) => {
        const details = log.details;
        const llmModel = details && typeof details.llmModel === 'string'
            ? details.llmModel
            : (details && typeof details.llm_model === 'string' ? details.llm_model : '');
        const extractionModelName = details && typeof details.modelName === 'string' ? details.modelName : '';
        const extractionModelId = details && typeof details.modelId === 'string' ? details.modelId : '';
        return { llmModel, extractionModelName, extractionModelId };
    };

    const formatDate = (isoString: string) => {
        return new Date(isoString).toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const exportCSV = () => {
        if (!data?.items || data.items.length === 0) return;

        const headers = ['시간', '사용자', '액션', '리소스', 'LLM모델', '추출모델명', '추출모델ID', 'ID', '상태', 'DI 페이지', '토큰(전체)', '토큰(In)', '토큰(Out)'];
        const rows = data.items.map((log) => {
            const { llmModel, extractionModelName, extractionModelId } = getModelInfo(log);
            return [
                log.timestamp,
                log.user_email,
                log.action,
                log.resource_type,
                llmModel,
                extractionModelName,
                extractionModelId,
                log.resource_id,
                log.status || '',
                log.details?.diPageCount || '',
                log.details?.tokenUsage?.total_tokens || '',
                log.details?.tokenUsage?.prompt_tokens || '',
                log.details?.tokenUsage?.completion_tokens || ''
            ];
        });

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="p-6">
            <Card className="overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-xl">
                                <Activity className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-foreground">활동 로그</h2>
                                <p className="text-sm text-muted-foreground">시스템 활동 기록</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => refetch()}>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                새로고침
                            </Button>
                            <Button onClick={exportCSV} disabled={!data?.items || data.items.length === 0}>
                                <Download className="w-4 h-4 mr-2" />
                                CSV 내보내기
                            </Button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap gap-3">
                        <Select value={action || 'all'} onValueChange={(val) => setAction(val === 'all' ? '' : val as AuditAction)}>
                            <SelectTrigger className="w-37.5">
                                <SelectValue placeholder="전체 액션" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체 액션</SelectItem>
                                <SelectItem value="CREATE">CREATE</SelectItem>
                                <SelectItem value="UPDATE">UPDATE</SelectItem>
                                <SelectItem value="DELETE">DELETE</SelectItem>
                                <SelectItem value="READ">READ</SelectItem>
                                <SelectItem value="EXTRACT">EXTRACT</SelectItem>
                                <SelectItem value="WEBHOOK">WEBHOOK</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={resourceType || 'all'} onValueChange={(val) => setResourceType(val === 'all' ? '' : val as AuditResource)}>
                            <SelectTrigger className="w-37.5">
                                <SelectValue placeholder="전체 리소스" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체 리소스</SelectItem>
                                <SelectItem value="model">모델</SelectItem>
                                <SelectItem value="extraction">추출</SelectItem>
                                <SelectItem value="document">문서</SelectItem>
                                <SelectItem value="user">사용자</SelectItem>
                                <SelectItem value="group">그룹</SelectItem>
                            </SelectContent>
                        </Select>

                        <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-auto"
                        />

                        <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-auto"
                        />

                        <Button variant="secondary" onClick={() => refetch()}>
                            <Search className="w-4 h-4 mr-2" />
                            검색
                        </Button>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-muted border-b border-border">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <Calendar className="w-4 h-4 inline mr-1" />
                                    시간
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <User className="w-4 h-4 inline mr-1" />
                                    사용자
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    액션
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    리소스
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    LLM 모델
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    ID
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    상태
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    DI 페이지
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    토큰 사용량
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                                        로딩 중...
                                    </td>
                                </tr>
                            ) : data && data.items.length > 0 ? (
                                data.items.map((log) => {
                                    const { llmModel } = getModelInfo(log);
                                    return (
                                    <tr key={log.id} className="hover:bg-accent">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                            {formatDate(log.timestamp)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-medium">
                                            {log.user_email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${actionColors[log.action] || 'bg-muted text-muted-foreground'}`}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                            {log.resource_type}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                            {llmModel ? (
                                                <span className="font-mono text-foreground">{llmModel}</span>
                                            ) : (
                                                <span className="text-muted-foreground/40">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground font-mono">
                                            <TooltipProvider delayDuration={300}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="cursor-default">
                                                            {log.resource_id.substring(0, 8)}...
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="font-mono text-xs">
                                                        {log.resource_id}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span
                                                className={`text-xs ${log.status === 'SUCCESS' ? 'text-green-600' : 'text-red-600'
                                                    }`}
                                            >
                                                {log.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                            {log.action === 'EXTRACT' && log.status === 'SUCCESS' && log.details?.diPageCount !== undefined ? (
                                                <span className="font-medium text-foreground">{log.details.diPageCount}p</span>
                                            ) : (
                                                <span className="text-muted-foreground/40">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                                            {log.action === 'EXTRACT' && log.status === 'SUCCESS' && log.details?.tokenUsage ? (
                                                <div className="flex flex-col gap-0.5 text-xs">
                                                    <span>총: {log.details.tokenUsage.total_tokens?.toLocaleString() || 0}</span>
                                                    <span className="text-muted-foreground/70">
                                                        (In: {log.details.tokenUsage.prompt_tokens?.toLocaleString() || 0}, Out: {log.details.tokenUsage.completion_tokens?.toLocaleString() || 0})
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground/40">-</span>
                                            )}
                                        </td>
                                    </tr>
                                )})
                            ) : (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                                        감사 로그가 없습니다
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
