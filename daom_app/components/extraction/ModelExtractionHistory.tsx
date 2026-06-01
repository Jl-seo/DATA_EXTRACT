'use client';

import { useState, useMemo } from 'react';
import {
    Clock, Search, AlertTriangle, Download, RefreshCw,
    FileText, CheckCircle2, XCircle, Loader2, Eye, X
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ExtractionLogTable } from './ExtractionLogTable';
import type { ExtractionLog } from '@/components/extraction/types';
import { isSuccessStatus, isErrorStatus, isProcessingStatus } from '@/lib/extraction-status';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useExtraction } from './context/ExtractionContext';
import { deleteExtractionLog } from '@/actions/extractionLog';

// 날짜 필터 타입
type DatePreset = 'all' | 'today' | 'week' | 'month';

interface ModelExtractionHistoryProps {
    modelId: string;
}

export function ModelExtractionHistory({ modelId }: ModelExtractionHistoryProps) {
    const { data: session } = useSession();

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'processing' | 'error'>('all');
    const [dateFilter, setDateFilter] = useState<DatePreset>('all');
    const [ownershipTab, setOwnershipTab] = useState<'my' | 'all'>('all');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectedLog, setSelectedLog] = useState<ExtractionLog | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // 추출 로그 조회
    const { data: logs = [], isLoading, error, refetch } = useQuery({
        queryKey: ['extraction-logs', modelId],
        queryFn: async () => {
            const res = await fetch(`/api/extraction/logs/by-model/${modelId}?limit=200`);
            if (!res.ok) throw new Error('Failed to fetch logs');
            return res.json() as Promise<ExtractionLog[]>;
        },
        refetchInterval: (query) => {
            const data = query.state.data;
            if (!data) return 5000;
            // 진행 중인 작업이 있으면 3초, 없으면 30초마다 갱신
            const hasActiveJobs = data.some(log => isProcessingStatus(log.status));
            return hasActiveJobs ? 3000 : 30000;
        },
        staleTime: 1000,
    });

    // 날짜 범위 체크
    const isWithinDateRange = (dateStr: string): boolean => {
        if (dateFilter === 'all') return true;
        const logDate = new Date(dateStr);
        const now = new Date();
        switch (dateFilter) {
            case 'today': {
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const logDay = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate());
                return logDay.getTime() === today.getTime();
            }
            case 'week': {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return logDate >= weekAgo;
            }
            case 'month': {
                const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                return logDate >= monthAgo;
            }
            default:
                return true;
        }
    };

    // 필터링된 로그
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            // 파일명 검색
            const matchesSearch = log.filename.toLowerCase().includes(searchTerm.toLowerCase());

            // 상태 필터
            let matchesStatus = false;
            switch (statusFilter) {
                case 'all': matchesStatus = true; break;
                case 'success': matchesStatus = isSuccessStatus(log.status); break;
                case 'processing': matchesStatus = isProcessingStatus(log.status); break;
                case 'error': matchesStatus = isErrorStatus(log.status); break;
                default: matchesStatus = true;
            }

            // 날짜 필터
            const matchesDate = isWithinDateRange(log.created_at);

            // 내 기록 / 전체 필터
            let matchesOwner = true;
            if (ownershipTab === 'my' && session?.user?.email) {
                matchesOwner =
                    log.user_id === session.user.oid ||
                    log.created_by?.upn === session.user.upn ||
                    log.created_by?.object_id === session.user.oid;
            }

            return matchesSearch && matchesStatus && matchesDate && matchesOwner;
        });
    }, [logs, searchTerm, statusFilter, dateFilter, ownershipTab, session]);

    // 통계
    const stats = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return {
            total: filteredLogs.length,
            success: filteredLogs.filter(l => isSuccessStatus(l.status)).length,
            processing: filteredLogs.filter(l => isProcessingStatus(l.status)).length,
            error: filteredLogs.filter(l => isErrorStatus(l.status)).length,
            today: filteredLogs.filter(l => {
                const logDate = new Date(l.created_at);
                logDate.setHours(0, 0, 0, 0);
                return logDate.getTime() === today.getTime();
            }).length,
        };
    }, [filteredLogs]);

    // 선택 핸들러
    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };
    const selectAll = () => setSelectedIds(new Set(filteredLogs.map(l => l.id)));
    const clearSelection = () => setSelectedIds(new Set());

    // 일괄 Excel 다운로드
    const handleBulkDownload = () => {
        const selectedLogs = filteredLogs.filter(l => selectedIds.has(l.id) && isSuccessStatus(l.status));
        if (selectedLogs.length === 0) {
            toast.error('다운로드할 성공 기록이 없습니다');
            return;
        }
        // JSON to CSV 변환
        const allData = selectedLogs.map(log => ({
            파일명: log.filename,
            상태: log.status,
            날짜: log.created_at,
        }));
        const headers = Object.keys(allData[0]).join(',');
        const rows = allData.map(row => Object.values(row).join(','));
        const csv = [headers, ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `extraction_logs_${new Date().toLocaleDateString('ko-KR')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`${selectedLogs.length}개 파일 다운로드 완료!`);
        clearSelection();
    };

    const { loadFromHistory } = useExtraction();

    // 개별 액션
    const handleView = (log: ExtractionLog) => loadFromHistory(log);
    const handleDownload = (log: ExtractionLog) => {
        if (!log.extracted_data) { toast.error('추출 데이터가 없습니다'); return; }
        const data = [{ 파일명: log.filename, ...log.extracted_data }];
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => Object.values(row).map(v => JSON.stringify(v ?? '')).join(','));
        const csv = [headers, ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${log.filename}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('다운로드 완료');
    };
    const handleRetry = (log: ExtractionLog) => toast.info('다시 추출 기능은 준비 중입니다.');
    const handleCancel = (log: ExtractionLog) => toast.info('작업 취소 기능은 준비 중입니다.');
    const handleDelete = async (log: ExtractionLog) => {
        if (!log?.id) {
            toast.error('삭제할 기록 ID를 찾을 수 없습니다.');
            return;
        }

        const confirmed = window.confirm(`"${log.filename || 'Untitled'}" 추출 기록을 삭제하시겠습니까?`);
        if (!confirmed) return;

        try {
            setDeletingId(log.id);
            await deleteExtractionLog(log.id);
            toast.success('추출 기록이 삭제되었습니다.');
            await refetch();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '알 수 없는 오류';
            toast.error(`삭제 실패: ${message}`);
        } finally {
            setDeletingId(null);
        }
    };

    // 날짜 포맷
    const formatDate = (iso: string) =>
        new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    return (
        <div className="flex-1 overflow-auto bg-background">
            <div className="max-w-7xl mx-auto p-6 space-y-4">

                {/* 통계 카드 */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: '전체', value: stats.total, icon: FileText, color: 'text-foreground', bg: 'bg-muted' },
                        { label: '오늘', value: stats.today, icon: Clock, color: 'text-primary', bg: 'bg-primary/10' },
                        { label: '성공', value: stats.success, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30' },
                        { label: '진행 중', value: stats.processing, icon: Loader2, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
                        { label: '실패', value: stats.error, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' },
                    ].map(({ label, value, icon: Icon, color, bg }) => (
                        <Card key={label} className={`p-4 ${bg} border-none`}>
                            <div className="flex items-center gap-2">
                                <Icon className={`w-4 h-4 ${color}`} />
                                <span className="text-xs text-muted-foreground">{label}</span>
                            </div>
                            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
                        </Card>
                    ))}
                </div>

                {/* 필터 영역 */}
                <Card className="p-4">
                    <div className="flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
                        {/* 왼쪽: 검색 + 내기록/팀전체 */}
                        <div className="flex items-center gap-3 w-full xl:w-auto flex-1">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="파일명 검색..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                            <div className="flex bg-muted rounded-full p-1">
                                <button
                                    onClick={() => setOwnershipTab('my')}
                                    className={`px-4 py-1 rounded-full text-xs font-semibold transition-all ${ownershipTab === 'my' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    내 기록
                                </button>
                                <button
                                    onClick={() => setOwnershipTab('all')}
                                    className={`px-4 py-1 rounded-full text-xs font-semibold transition-all ${ownershipTab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    팀 전체
                                </button>
                            </div>
                        </div>

                        {/* 오른쪽: 날짜 + 상태 + 새로고침 */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* 날짜 필터 */}
                            <div className="flex gap-1">
                                {(['all', 'today', 'week', 'month'] as DatePreset[]).map(preset => (
                                    <Button
                                        key={preset}
                                        size="sm"
                                        variant={dateFilter === preset ? 'default' : 'ghost'}
                                        onClick={() => setDateFilter(preset)}
                                        className="h-8 text-xs"
                                    >
                                        {{ all: '전체', today: '오늘', week: '1주', month: '1달' }[preset]}
                                    </Button>
                                ))}
                            </div>
                            <div className="h-6 w-px bg-border" />
                            {/* 상태 필터 */}
                            <div className="flex gap-1">
                                {[
                                    { key: 'all', label: '전체' },
                                    { key: 'processing', label: '진행 중' },
                                    { key: 'success', label: '성공' },
                                    { key: 'error', label: '실패' },
                                ].map(({ key, label }) => (
                                    <Button
                                        key={key}
                                        size="sm"
                                        variant={statusFilter === key ? 'default' : 'ghost'}
                                        onClick={() => setStatusFilter(key as any)}
                                        className="h-8 text-xs"
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                            <div className="h-6 w-px bg-border" />
                            <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8">
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                새로고침
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* 일괄 선택 액션 바 */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-primary">{selectedIds.size}개 선택됨</span>
                            <Button
                                size="sm"
                                onClick={handleBulkDownload}
                                className="bg-green-600 hover:bg-green-700 h-8 text-white"
                            >
                                <Download className="w-4 h-4 mr-1.5" />
                                일괄 다운로드
                            </Button>
                        </div>
                        <Button onClick={clearSelection} variant="ghost" size="sm" className="h-8">
                            선택 해제
                        </Button>
                    </div>
                )}

                {/* 테이블 */}
                <Card className="overflow-hidden">
                    {isLoading && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin text-primary" />
                                <p className="text-muted-foreground">기록을 불러오는 중...</p>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-destructive" />
                                <p className="font-semibold text-foreground">기록을 불러올 수 없습니다</p>
                                <Button variant="outline" onClick={() => refetch()} className="mt-3">
                                    다시 시도
                                </Button>
                            </div>
                        </div>
                    )}

                    {!isLoading && !error && filteredLogs.length === 0 && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center text-muted-foreground">
                                <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                                <p className="text-lg font-semibold text-foreground">추출 기록이 없습니다</p>
                                <p className="text-sm mt-1">
                                    {searchTerm || statusFilter !== 'all' || dateFilter !== 'all'
                                        ? '검색 조건에 맞는 기록이 없습니다'
                                        : '이 모델로 추출한 문서의 기록이 표시됩니다'}
                                </p>
                            </div>
                        </div>
                    )}

                    {!isLoading && !error && filteredLogs.length > 0 && (
                        <ExtractionLogTable
                            logs={filteredLogs}
                            showModelColumn={false}
                            onView={handleView}
                            onDownload={handleDownload}
                            onRetry={handleRetry}
                            onCancel={deletingId ? undefined : handleCancel}
                            onDelete={deletingId ? undefined : handleDelete}
                        />
                    )}
                </Card>
            </div>

        </div>
    );
}
