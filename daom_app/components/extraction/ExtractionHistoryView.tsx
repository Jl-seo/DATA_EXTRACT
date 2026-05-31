'use client';

import { useState, useMemo } from 'react';
import {
    Upload, History, Search, CheckCircle2,
    XCircle, Loader2, FileText, RefreshCw, Eye, X, AlertTriangle, Trash2, Link, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { ExtractionModel, ExtractionLog } from './types';
import { isSuccessStatus, isProcessingStatus, isErrorStatus } from '@/lib/extraction-status';
import { deleteExtractionLog, getExtractionLog } from '@/actions/extractionLog';
import { toast } from 'sonner';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { useMultifileUploadFeature } from '@/queries/env';

type DatePreset = 'all' | 'today' | 'week' | 'month' | 'custom';
type StatusFilter = 'all' | 'success' | 'processing' | 'error';
type OwnerFilter = 'all' | 'mine' | 'others';
type QuickDatePreset = Exclude<DatePreset, 'custom'>;
type ExcelCellValue = string | number | boolean | Date | null;
type ExcelRow = ExcelCellValue[];
type FieldDefinition = ExtractionModel['fields'][number];

const quickDatePresets: Array<{ key: QuickDatePreset; label: string }> = [
    { key: 'all', label: '전체' },
    { key: 'today', label: '오늘' },
    { key: 'week', label: '1주' },
    { key: 'month', label: '1달' },
];

interface ExtractionHistoryViewProps {
    model: ExtractionModel;
    onNewExtraction: (mode: 'single' | 'multi') => void;
    onSelectHistory: (log: ExtractionLog) => void;
}

type SourceFilenameCarrier = {
    metadata?: Record<string, unknown>;
    file?: { filename?: string };
    candidate_files?: Array<{ filename?: string }>;
};

const SYSTEM_EXPORT_KEYS = new Set([
    'other_data',
    'raw_tables',
    'raw_content',
    'beta_metadata',
    'comparisons',
    'comparison_count',
    'mode',
]);

const getSourceFilenames = (log: SourceFilenameCarrier): string[] => {
    const fromMetadata = Array.isArray(log.metadata?.source_filenames)
        ? log.metadata.source_filenames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        : [];
    if (fromMetadata.length > 0) {
        return Array.from(new Set(fromMetadata));
    }

    const fallback: string[] = [];
    if (log.file?.filename) fallback.push(log.file.filename);
    if (Array.isArray(log.candidate_files)) {
        log.candidate_files.forEach((candidate) => {
            if (candidate?.filename) fallback.push(candidate.filename);
        });
    }
    return Array.from(new Set(fallback));
};

const formatPrimaryFilename = (log: SourceFilenameCarrier, defaultFilename: string): string => {
    const sourceNames = getSourceFilenames(log);
    if (sourceNames.length === 0) return defaultFilename;
    if (sourceNames.length === 1) return sourceNames[0];
    return `${sourceNames[0]} 외 ${sourceNames.length - 1}건`;
};

const normalizeExcelText = (value: string): string => {
    return value.normalize('NFC');
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const unwrapExtractedValue = (value: unknown): unknown => {
    if (isRecord(value) && 'value' in value) {
        return value.value;
    }
    return value;
};

const toExcelCellValue = (value: unknown): ExcelCellValue => {
    const unwrapped = unwrapExtractedValue(value);
    if (unwrapped === null || unwrapped === undefined) return '';
    if (typeof unwrapped === 'string') return normalizeExcelText(unwrapped);
    if (typeof unwrapped === 'number' || typeof unwrapped === 'boolean') return unwrapped;
    if (unwrapped instanceof Date) return unwrapped;
    return normalizeExcelText(JSON.stringify(unwrapped));
};

const isTableRows = (value: unknown): value is Array<Record<string, unknown>> => {
    const unwrapped = unwrapExtractedValue(value);
    return Array.isArray(unwrapped) && unwrapped.every((row) => isRecord(row));
};

const getGuideData = (log: ExtractionLog): Record<string, unknown> => {
    if (isRecord(log.extracted_data)) return log.extracted_data;
    const guideExtracted = log.preview_data?.guide_extracted;
    if (isRecord(guideExtracted)) return guideExtracted;
    return {};
};

const getFieldRawValue = (log: ExtractionLog, key: string): unknown => {
    const extractedData = isRecord(log.extracted_data) ? log.extracted_data : {};
    if (key in extractedData) return extractedData[key];

    const guideExtracted = log.preview_data?.guide_extracted;
    if (isRecord(guideExtracted) && key in guideExtracted) return guideExtracted[key];

    return undefined;
};

const getTableRows = (log: ExtractionLog, key: string): Array<Record<string, unknown>> => {
    const rawValue = getFieldRawValue(log, key);
    const unwrapped = unwrapExtractedValue(rawValue);
    return isTableRows(unwrapped) ? unwrapped : [];
};

const getTableHeaders = (field: FieldDefinition | undefined, rows: Array<Record<string, unknown>>): Array<{ key: string; label: string }> => {
    if (field?.sub_fields && field.sub_fields.length > 0) {
        return field.sub_fields
            .filter((subField) => subField.key.trim().length > 0)
            .map((subField) => ({ key: subField.key, label: normalizeExcelText(subField.key) }));
    }

    const keys = new Set<string>();
    rows.forEach((row) => {
        Object.keys(row).forEach((key) => keys.add(key));
    });
    return Array.from(keys).map((key) => ({ key, label: normalizeExcelText(key) }));
};

const getExportFilename = (log: ExtractionLog): string => {
    return normalizeExcelText(formatPrimaryFilename(log as SourceFilenameCarrier, log.filename || 'Untitled'));
};

const sanitizeSheetName = (value: string, fallback: string): string => {
    const sanitized = normalizeExcelText(value).replace(/[\[\]*?/\\:]/g, '_').trim() || fallback;
    return sanitized.slice(0, 31);
};

const getUniqueSheetName = (sheetName: string, usedSheetNames: Set<string>): string => {
    const baseName = sanitizeSheetName(sheetName, 'Sheet');
    let candidate = baseName;
    let index = 2;

    while (usedSheetNames.has(candidate)) {
        const suffix = `_${index}`;
        candidate = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
        index += 1;
    }

    usedSheetNames.add(candidate);
    return candidate;
};

const sanitizeDownloadFilename = (filename: string): string => {
    return normalizeExcelText(filename).replace(/[\\/:*?"<>|]/g, '_').trim() || 'extraction_result';
};

const getTableKeySet = (log: ExtractionLog, model: ExtractionModel): Set<string> => {
    const guideData = getGuideData(log);
    const modelFields = model.fields || [];
    const tableKeys = new Set(
        modelFields
            .filter((field) => field.type === 'table')
            .map((field) => field.key)
    );
    Object.entries(guideData).forEach(([key, value]) => {
        if (isTableRows(value)) tableKeys.add(key);
    });
    return tableKeys;
};

const buildGeneralDataRecord = (log: ExtractionLog, model: ExtractionModel): Record<string, ExcelCellValue> => {
    const guideData = getGuideData(log);
    const modelFields = model.fields || [];
    const tableKeys = getTableKeySet(log, model);
    const record: Record<string, ExcelCellValue> = {};
    const exportedKeys = new Set<string>();

    modelFields.forEach((field) => {
        if (tableKeys.has(field.key) || SYSTEM_EXPORT_KEYS.has(field.key)) return;
        const value = getFieldRawValue(log, field.key);
        if (value === undefined) return;
        exportedKeys.add(field.key);
        record[normalizeExcelText(field.key)] = toExcelCellValue(value);
    });

    Object.entries(guideData).forEach(([key, value]) => {
        if (exportedKeys.has(key) || tableKeys.has(key) || SYSTEM_EXPORT_KEYS.has(key)) return;
        record[normalizeExcelText(key)] = toExcelCellValue(value);
    });

    return record;
};

const buildKeyDataTableRows = (logs: ExtractionLog[], model: ExtractionModel): ExcelRow[] => {
    const records = logs.map((log) => ({
        filename: getExportFilename(log),
        values: buildGeneralDataRecord(log, model),
    }));
    const headers: string[] = ['filename'];
    const headerSet = new Set(headers);

    (model.fields || []).forEach((field) => {
        const normalizedKey = normalizeExcelText(field.key);
        if (field.type === 'table' || SYSTEM_EXPORT_KEYS.has(field.key) || headerSet.has(normalizedKey)) return;
        if (records.some((record) => record.values[normalizedKey] !== undefined)) {
            headers.push(normalizedKey);
            headerSet.add(normalizedKey);
        }
    });

    records.forEach((record) => {
        Object.keys(record.values).forEach((key) => {
            if (headerSet.has(key)) return;
            headers.push(key);
            headerSet.add(key);
        });
    });

    const rows: ExcelRow[] = [headers];
    records.forEach((record) => {
        rows.push([
            record.filename,
            ...headers.slice(1).map((key) => record.values[key] ?? ''),
        ]);
    });
    return rows;
};

const getExportTableFields = (log: ExtractionLog, model: ExtractionModel): FieldDefinition[] => {
    const guideData = getGuideData(log);
    const fieldsByKey = new Map((model.fields || []).map((field) => [field.key, field]));
    const tableFields: FieldDefinition[] = [];
    const addedKeys = new Set<string>();

    (model.fields || []).forEach((field) => {
        const value = getFieldRawValue(log, field.key);
        if (field.type === 'table' || isTableRows(value)) {
            tableFields.push(field);
            addedKeys.add(field.key);
        }
    });

    Object.entries(guideData).forEach(([key, value]) => {
        if (addedKeys.has(key) || SYSTEM_EXPORT_KEYS.has(key) || !isTableRows(value)) return;
        tableFields.push(fieldsByKey.get(key) || { key, label: key, type: 'table', sub_fields: [] });
        addedKeys.add(key);
    });

    return tableFields;
};

const appendSeparatedBlock = (targetRows: ExcelRow[], blockRows: ExcelRow[]) => {
    if (targetRows.length > 0) {
        targetRows.push([]);
    }
    targetRows.push(...blockRows);
};

const exportExtractionLogsToExcel = async (logs: ExtractionLog[], model: ExtractionModel) => {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    const usedSheetNames = new Set<string>();

    const keyDataRows = buildKeyDataTableRows(logs, model);
    const tableRowsByKey = new Map<string, ExcelRow[]>();

    logs.forEach((log) => {
        const filename = getExportFilename(log);

        getExportTableFields(log, model).forEach((field) => {
            const tableRows = getTableRows(log, field.key);
            const headers = getTableHeaders(field, tableRows);
            if (headers.length === 0) return;

            const sheetRows = tableRowsByKey.get(field.key) || [];
            appendSeparatedBlock(sheetRows, [
                [filename],
                [],
                headers.map((header) => header.label),
                ...tableRows.map((row) => headers.map((header) => toExcelCellValue(row[header.key]))),
            ]);
            tableRowsByKey.set(field.key, sheetRows);
        });
    });

    const keyDataSheet = XLSX.utils.aoa_to_sheet(keyDataRows.length > 0 ? keyDataRows : [['추출 데이터 없음']]);
    XLSX.utils.book_append_sheet(workbook, keyDataSheet, getUniqueSheetName('KeyData', usedSheetNames));

    tableRowsByKey.forEach((rows, tableKey) => {
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, getUniqueSheetName(tableKey, usedSheetNames));
    });

    const downloadName = logs.length === 1
        ? `${sanitizeDownloadFilename(getExportFilename(logs[0]))}_추출결과.xlsx`
        : `선택_추출결과_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;

    XLSX.writeFile(workbook, downloadName);
};

const toDateBoundaryISOString = (dateValue: string, boundary: 'start' | 'end'): string => {
    const parts = dateValue.split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        return '';
    }

    const [year, month, day] = parts;
    const date = boundary === 'start'
        ? new Date(year, month - 1, day, 0, 0, 0, 0)
        : new Date(year, month - 1, day, 23, 59, 59, 999);

    return date.toISOString();
};

export function ExtractionHistoryView({
    model,
    onNewExtraction,
    onSelectHistory
}: ExtractionHistoryViewProps) {
    const { data: isMultifileUploadEnabled = false } = useMultifileUploadFeature();
    const [searchTerm, setSearchTerm] = useState('');
    const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [dateFilter, setDateFilter] = useState<DatePreset>('all');
    const [customDateStart, setCustomDateStart] = useState('');
    const [customDateEnd, setCustomDateEnd] = useState('');
    const [selectedLog, setSelectedLog] = useState<ExtractionLog | null>(null);
    const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isLoadingLog, setIsLoadingLog] = useState<string | null>(null);
    const [isDownloadingSelected, setIsDownloadingSelected] = useState(false);
    const PAGE_SIZE = 50;
    const queryClient = useQueryClient();
    const dateRange = useMemo(() => {
        if (dateFilter === 'all') {
            return { dateStart: '', dateEnd: '' };
        }

        if (dateFilter === 'custom') {
            return {
                dateStart: customDateStart ? toDateBoundaryISOString(customDateStart, 'start') : '',
                dateEnd: customDateEnd ? toDateBoundaryISOString(customDateEnd, 'end') : '',
            };
        }

        const now = new Date();

        if (dateFilter === 'today') {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return { dateStart: start.toISOString(), dateEnd: now.toISOString() };
        }

        if (dateFilter === 'week') {
            const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return { dateStart: start.toISOString(), dateEnd: now.toISOString() };
        }

        const start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        return { dateStart: start.toISOString(), dateEnd: now.toISOString() };
    }, [customDateEnd, customDateStart, dateFilter]);

    const hasActiveFilters = searchTerm.trim().length > 0
        || ownerFilter !== 'all'
        || statusFilter !== 'all'
        || dateFilter !== 'all'
        || customDateStart.length > 0
        || customDateEnd.length > 0;

    // 모델별 추출 로그 조회 (Infinite Query 적용)
    const {
        data,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useInfiniteQuery({
        queryKey: [
            'extraction-logs',
            model.id,
            searchTerm,
            ownerFilter,
            statusFilter,
            dateRange.dateStart,
            dateRange.dateEnd,
        ],
        queryFn: async ({ pageParam = 0 }) => {
            const params = new URLSearchParams({
                limit: PAGE_SIZE.toString(),
                offset: pageParam.toString(),
            });

            if (searchTerm.trim()) {
                params.set('keyword', searchTerm.trim());
            }
            if (ownerFilter !== 'all') {
                params.set('ownerScope', ownerFilter);
            }
            if (statusFilter !== 'all') {
                params.set('status', statusFilter);
            }
            if (dateRange.dateStart) {
                params.set('dateStart', dateRange.dateStart);
            }
            if (dateRange.dateEnd) {
                params.set('dateEnd', dateRange.dateEnd);
            }

            const res = await fetch(`/api/extraction/logs/by-model/${model.id}?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch logs');
            return await res.json() as ExtractionLog[];
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.length < PAGE_SIZE) return undefined;
            return allPages.length * PAGE_SIZE;
        },
        // 진행 중인 작업이 있으면 3초, 없으면 30초마다 자동 갱신
        refetchInterval: (query) => {
            const pages = query.state.data?.pages;
            if (!pages || pages.length === 0) return 5000;
            const hasActiveJobs = pages.some(page => page.some(log => isProcessingStatus(log.status)));
            return hasActiveJobs ? 3000 : 30000;
        },
    });

    const logs = useMemo(() => data?.pages.flat() || [], [data]);

    // 무한 스크롤 트리거
    const observerRef = useIntersectionObserver(([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    });

    // 전체 통계 조회 (페이지네이션 무관하게 전체 카운트)
    const { data: globalStats, refetch: refetchStats } = useQuery({
        queryKey: ['extraction-stats', model.id],
        queryFn: async () => {
            const res = await fetch(`/api/extraction/stats/by-model/${model.id}`);
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json() as Promise<{ total: number, success: number, processing: number, error: number }>;
        },
        refetchInterval: 30000,
    });

    const handleRefetch = () => {
        refetch();
        refetchStats();
    };

    const handleQuickDatePresetSelect = (preset: QuickDatePreset) => {
        setDateFilter(preset);
        setCustomDateStart('');
        setCustomDateEnd('');
    };

    const filteredLogs = logs;
    const selectableLogs = useMemo(
        () => filteredLogs.filter((log) => isSuccessStatus(log.status)),
        [filteredLogs]
    );
    const selectedLogs = useMemo(
        () => selectableLogs.filter((log) => selectedLogIds.has(log.id)),
        [selectableLogs, selectedLogIds]
    );
    const allSelectableChecked = selectableLogs.length > 0 && selectableLogs.every((log) => selectedLogIds.has(log.id));
    const someSelectableChecked = selectedLogs.length > 0 && !allSelectableChecked;

    const toggleLogSelection = (logId: string, checked: boolean) => {
        setSelectedLogIds((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(logId);
            } else {
                next.delete(logId);
            }
            return next;
        });
    };

    const toggleVisibleSelection = (checked: boolean) => {
        setSelectedLogIds((current) => {
            const next = new Set(current);
            selectableLogs.forEach((log) => {
                if (checked) {
                    next.add(log.id);
                } else {
                    next.delete(log.id);
                }
            });
            return next;
        });
    };

    const handleSelectedDownload = async () => {
        if (selectedLogs.length === 0) {
            toast.info('다운로드할 추출 기록을 선택해주세요.');
            return;
        }

        setIsDownloadingSelected(true);
        try {
            const detailedLogs = await Promise.all(
                selectedLogs.map(async (log) => {
                    const freshLog = await getExtractionLog(log.id);
                    return (freshLog || log) as ExtractionLog;
                })
            );
            await exportExtractionLogsToExcel(detailedLogs, model);
            toast.success(`${detailedLogs.length}개 추출 기록을 다운로드했습니다.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : '알 수 없는 오류';
            toast.error(`다운로드 실패: ${message}`);
        } finally {
            setIsDownloadingSelected(false);
        }
    };

    // 통계 (전체 데이터 기준 우선, 없을 시 현재 로드된 기준)
    const stats = useMemo(() => ({
        total: globalStats?.total ?? logs.length,
        success: globalStats?.success ?? logs.filter(l => isSuccessStatus(l.status)).length,
        processing: globalStats?.processing ?? logs.filter(l => isProcessingStatus(l.status)).length,
        error: globalStats?.error ?? logs.filter(l => isErrorStatus(l.status)).length,
    }), [logs, globalStats]);


    const formatDate = (iso: string) => {
        try { return format(new Date(iso), 'MM.dd HH:mm', { locale: ko }); }
        catch { return iso; }
    };

    const getStatusBadge = (status: string) => {
        if (isSuccessStatus(status)) return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">성공</Badge>;
        if (isProcessingStatus(status)) return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-xs">진행 중</Badge>;
        if (isErrorStatus(status)) return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-xs">실패</Badge>;
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    };

    return (
        <div className="flex-1 flex flex-col bg-muted/30 h-full overflow-hidden">
            {/* 헤더 */}
            <div className="p-6 pb-4 bg-background border-b border-border">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            {model.name}
                            <Badge variant="outline" className="font-normal">
                                {model.fields?.length || 0}개 필드
                            </Badge>
                        </h1>
                        {model.description && (
                            <p className="text-muted-foreground mt-1">{model.description}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {!model.is_super_model && (
                            <>
                                <Button
                                    size="lg"
                                    onClick={() => onNewExtraction('single')}
                                    className="shadow-lg shadow-primary/20 transition-transform hover:scale-105"
                                >
                                    <Upload className="w-4 h-4 mr-2" />
                                    새 문서 추출하기
                                </Button>
                                {isMultifileUploadEnabled && (
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        onClick={() => onNewExtraction('multi')}
                                        className="transition-transform hover:scale-105"
                                    >
                                        <Upload className="w-4 h-4 mr-2" />
                                        다중문서 추출하기
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* 통계 요약 */}
                <div className="flex gap-3">
                    {[
                        { label: '전체', value: stats.total, icon: FileText, color: 'text-foreground' },
                        { label: '성공', value: stats.success, icon: CheckCircle2, color: 'text-green-600' },
                        { label: '진행 중', value: stats.processing, icon: Loader2, color: 'text-amber-600' },
                        { label: '실패', value: stats.error, icon: XCircle, color: 'text-red-600' },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="flex items-center gap-1.5 text-sm">
                            <Icon className={`w-4 h-4 ${color}`} />
                            <span className="text-muted-foreground">{label}</span>
                            <span className={`font-bold ${color}`}>{value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 필터 */}
            <div className="px-6 py-3 bg-background border-b border-border space-y-3">
                <div className="flex items-center gap-3">
                    <div className="relative w-full max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                            placeholder="파일명 또는 추출자명 검색..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 h-8 text-sm"
                        />
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleRefetch} className="ml-auto h-8">
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        새로고침
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">기록</span>
                        <div className="flex gap-1">
                            {[
                                { key: 'all', label: '전체 기록' },
                                { key: 'mine', label: '내 기록' },
                                { key: 'others', label: '팀 기록' },
                            ].map(({ key, label }) => (
                                <Button
                                    key={key}
                                    size="sm"
                                    variant={ownerFilter === key ? 'default' : 'ghost'}
                                    onClick={() => setOwnerFilter(key as OwnerFilter)}
                                    className="h-8 text-xs px-3"
                                >
                                    {label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">일자</span>
                        <div className="flex flex-wrap items-center gap-1">
                            {quickDatePresets.map(({ key, label }) => (
                                <Button key={key} size="sm" variant={dateFilter === key ? 'default' : 'ghost'}
                                    onClick={() => handleQuickDatePresetSelect(key)} className="h-8 text-xs px-3">
                                    {label}
                                </Button>
                            ))}
                            <Input
                                type="date"
                                value={customDateStart}
                                onChange={(e) => {
                                    setCustomDateStart(e.target.value);
                                    setDateFilter('custom');
                                }}
                                className="h-8 w-[8rem] text-xs"
                                aria-label="검색 시작일"
                            />
                            <span className="text-xs text-muted-foreground">~</span>
                            <Input
                                type="date"
                                value={customDateEnd}
                                onChange={(e) => {
                                    setCustomDateEnd(e.target.value);
                                    setDateFilter('custom');
                                }}
                                className="h-8 w-[8rem] text-xs"
                                aria-label="검색 종료일"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">상태</span>
                        <div className="flex gap-1">
                            {[
                                { key: 'all', label: '전체' },
                                { key: 'processing', label: '진행 중' },
                                { key: 'success', label: '성공' },
                                { key: 'error', label: '실패' },
                            ].map(({ key, label }) => (
                                <Button key={key} size="sm" variant={statusFilter === key ? 'default' : 'ghost'}
                                    onClick={() => setStatusFilter(key as StatusFilter)} className="h-8 text-xs px-3">
                                    {label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* 추출 기록 목록 */}
            <div className="flex-1 px-6 py-4 overflow-auto">
                <Card className="h-full flex flex-col shadow-sm overflow-hidden">
                    <div className="p-3 border-b bg-muted/30 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={allSelectableChecked}
                            aria-checked={someSelectableChecked ? 'mixed' : allSelectableChecked}
                            disabled={selectableLogs.length === 0}
                            onChange={(event) => toggleVisibleSelection(event.target.checked)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 rounded border-border accent-primary disabled:opacity-40"
                            title="현재 목록 전체 선택"
                        />
                        <History className="w-4 h-4 text-muted-foreground" />
                        <span className="font-semibold text-sm">최근 추출 기록</span>
                        <span className="text-xs text-muted-foreground ml-1">({filteredLogs.length}건)</span>
                        {selectedLogs.length > 0 && (
                            <span className="text-xs text-primary ml-1">{selectedLogs.length}건 선택</span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSelectedDownload}
                            disabled={selectedLogs.length === 0 || isDownloadingSelected}
                            className="ml-auto h-8 text-xs"
                        >
                            {isDownloadingSelected
                                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                : <Download className="w-3.5 h-3.5 mr-1.5" />
                            }
                            선택 다운로드
                        </Button>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {isLoading && (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                                <span className="text-muted-foreground text-sm">불러오는 중...</span>
                            </div>
                        )}

                        {error && (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <AlertTriangle className="w-8 h-8 text-destructive mb-2" />
                                <p className="text-sm font-medium">데이터를 불러올 수 없습니다</p>
                                <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">
                                    다시 시도
                                </Button>
                            </div>
                        )}

                        {!isLoading && !error && filteredLogs.length === 0 && (
                            <div className="text-center text-muted-foreground py-12">
                                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p className="font-medium">
                                    {hasActiveFilters
                                        ? '검색 조건에 맞는 기록이 없습니다'
                                        : '추출 기록이 없습니다. 새 문서를 추출해보세요.'}
                                </p>
                            </div>
                        )}

                        {!isLoading && !error && filteredLogs.length > 0 && (
                            <div className="divide-y divide-border">
                                {filteredLogs.map((log) => (
                                    <div
                                        key={log.id}
                                        className="relative flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer group"
                                        onClick={async () => {
                                            if (isSuccessStatus(log.status) || isErrorStatus(log.status)) {
                                                setIsLoadingLog(log.id);
                                                try {
                                                    const freshLog = await getExtractionLog(log.id);
                                                    const targetLog = (freshLog || log) as ExtractionLog;

                                                    onSelectHistory(targetLog);
                                                } catch (err) {
                                                    console.error('Failed to load log details:', err);
                                                    onSelectHistory(log);
                                                } finally {
                                                    setIsLoadingLog(null);
                                                }
                                            }
                                        }}
                                    >
                                        {/* 로딩 오버레이 */}
                                        {isLoadingLog === log.id && (
                                            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10 transition-all">
                                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                            </div>
                                        )}
                                        <input
                                            type="checkbox"
                                            checked={selectedLogIds.has(log.id)}
                                            disabled={!isSuccessStatus(log.status)}
                                            onChange={(event) => toggleLogSelection(log.id, event.target.checked)}
                                            onClick={(event) => event.stopPropagation()}
                                            className="h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-40"
                                            title={isSuccessStatus(log.status) ? '다운로드 선택' : '성공 기록만 다운로드할 수 있습니다'}
                                        />
                                        {/* 상태 아이콘 */}
                                        <div className="shrink-0">
                                            {isSuccessStatus(log.status) && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                                            {isProcessingStatus(log.status) && <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />}
                                            {isErrorStatus(log.status) && <XCircle className="w-5 h-5 text-red-600" />}
                                        </div>

                                        {/* 파일명 */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                                                {formatPrimaryFilename(log as SourceFilenameCarrier, log.filename)}
                                            </p>
                                            {getSourceFilenames(log as SourceFilenameCarrier).length > 1 && (
                                                <p className="text-[11px] text-muted-foreground truncate">
                                                    {getSourceFilenames(log as SourceFilenameCarrier).join(', ')}
                                                </p>
                                            )}
                                            <p className="text-xs text-muted-foreground">
                                                {log.created_by?.name || log.user_name || '알 수 없음'} · {formatDate(log.created_at)}
                                            </p>
                                        </div>

                                        {/* 상태 배지 */}
                                        <div className="shrink-0">
                                            {getStatusBadge(log.status)}
                                        </div>

                                        {/* 액션 버튼 */}
                                        <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost" size="icon"
                                                className="h-7 w-7"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const url = `${window.location.origin}/extraction/run/${model.id}?logId=${log.id}`;
                                                    navigator.clipboard.writeText(url);
                                                    toast.success('링크가 클립보드에 복사되었습니다.');
                                                }}
                                                title="링크 복사"
                                            >
                                                <Link className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon"
                                                className="h-7 w-7"
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    setIsLoadingLog(log.id);
                                                    try {
                                                        const freshLog = await getExtractionLog(log.id);
                                                        setSelectedLog((freshLog || log) as ExtractionLog);
                                                    } catch {
                                                        setSelectedLog(log);
                                                    } finally {
                                                        setIsLoadingLog(null);
                                                    }
                                                }}
                                                title="상세 보기"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                disabled={deletingId === log.id}
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!confirm(`"${log.filename}" 추출 기록을 삭제하시겠습니까?`)) return;
                                                    setDeletingId(log.id);
                                                    try {
                                                        await deleteExtractionLog(log.id);
                                                        toast.success('추출 기록이 삭제되었습니다.');
                                                        toggleLogSelection(log.id, false);
                                                        queryClient.invalidateQueries({ queryKey: ['extraction-logs', model.id] });
                                                    } catch {
                                                        toast.error('삭제에 실패했습니다.');
                                                    } finally {
                                                        setDeletingId(null);
                                                    }
                                                }}
                                                title="삭제"
                                            >
                                                {deletingId === log.id
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <Trash2 className="w-3.5 h-3.5" />
                                                }
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {hasNextPage && (
                                    <div ref={observerRef} className="flex justify-center p-4 border-t border-border bg-muted/10">
                                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            {/* 상세 보기 모달 */}
            {selectedLog && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                    onClick={() => setSelectedLog(null)}
                >
                    <Card
                        className="max-w-lg w-full mx-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted">
                            <div>
                                <h3 className="font-bold">{formatPrimaryFilename(selectedLog as SourceFilenameCarrier, selectedLog.filename)}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {formatDate(selectedLog.created_at)} · {selectedLog.created_by?.name || '알 수 없음'}
                                </p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => setSelectedLog(null)}>
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                        <div className="p-5 max-h-100 overflow-auto">
                            {getSourceFilenames(selectedLog as SourceFilenameCarrier).length > 1 && (
                                <div className="bg-muted rounded-lg p-3 mb-3">
                                    <p className="text-xs font-semibold mb-1">업로드 파일 목록</p>
                                    <ul className="text-xs text-muted-foreground space-y-1">
                                        {getSourceFilenames(selectedLog as SourceFilenameCarrier).map((sourceName) => (
                                            <li key={sourceName}>- {sourceName}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {isErrorStatus(selectedLog.status) && (
                                <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-4 mb-3">
                                    <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">추출 실패</p>
                                    <p className="text-xs text-red-600">{selectedLog.error_message || selectedLog.error || '알 수 없는 오류'}</p>
                                </div>
                            )}
                            {selectedLog.extracted_data ? (
                                <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto">
                                    {JSON.stringify(selectedLog.extracted_data, null, 2)}
                                </pre>
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-6">추출 데이터가 없습니다</p>
                            )}
                        </div>
                        <div className="flex justify-between items-center px-5 py-4 border-t bg-muted">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const url = `${window.location.origin}/extraction/run/${model.id}?logId=${selectedLog.id}`;
                                    navigator.clipboard.writeText(url);
                                    toast.success('링크가 클립보드에 복사되었습니다.');
                                }}
                                className="text-primary border-primary/20"
                            >
                                <Link className="w-3.5 h-3.5 mr-1.5" />
                                링크 복사
                            </Button>
                            <div className="flex gap-2">
                                {isSuccessStatus(selectedLog.status) && (
                                    <Button
                                        size="sm"
                                        onClick={() => onSelectHistory(selectedLog)}
                                        className="bg-primary"
                                    >
                                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                                        결과 보기
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={() => setSelectedLog(null)}>닫기</Button>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

        </div>
    );
}
