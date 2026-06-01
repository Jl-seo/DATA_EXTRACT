'use client';

import { useState, useMemo } from 'react';
import { useExtractionModelNameMapByIds, useExtractionModels } from '@/queries/extraction';
import { Clock, Search, AlertTriangle, Check, ChevronsUpDown } from 'lucide-react';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ExtractionLogTable } from './ExtractionLogTable';
import type { ExtractionLog } from '@/components/extraction/types';
import type { ExtractionModel } from '@/scheme/extractionModel';
import { isSuccessStatus, isErrorStatus, isProcessingStatus } from '@/lib/extraction-status';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { deleteExtractionLog } from '@/actions/extractionLog';

interface ComboboxProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    searchPlaceholder?: string;
}

const Combobox = ({ value, onChange, options, placeholder, searchPlaceholder }: ComboboxProps) => {
    const [open, setOpen] = useState(false);

    const selectedLabel = useMemo(() => {
        if (value === 'all') return placeholder || '전체';
        return options.find((opt) => opt.value === value)?.label || placeholder;
    }, [value, options, placeholder]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-[200px] justify-between font-normal"
                >
                    {selectedLabel}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
                <Command>
                    <CommandInput placeholder={searchPlaceholder || '검색...'} />
                    <CommandList>
                        <CommandEmpty>결과가 없습니다.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="all"
                                onSelect={() => {
                                    onChange('all');
                                    setOpen(false);
                                }}
                            >
                                <Check
                                    className={cn(
                                        'mr-2 h-4 w-4',
                                        value === 'all' ? 'opacity-100' : 'opacity-0'
                                    )}
                                />
                                {placeholder || '전체'}
                            </CommandItem>
                            {options.map((opt) => (
                                <CommandItem
                                    key={opt.value}
                                    value={opt.label}
                                    onSelect={() => {
                                        onChange(opt.value);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 h-4 w-4',
                                            value === opt.value ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    {opt.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export function AllExtractionHistory() {
    const [modelFilter, setModelFilter] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'processing' | 'error'>('all');
    const PAGE_SIZE = 50;
    const queryClient = useQueryClient();

    // 활성화된 모델(상위 + 일반) 전체를 필터 옵션으로 사용
    const { data: models = [] } = useExtractionModels({ offset: 0, pageSize: 1000, isActive: true });

    // 활성 모델 중 필터 옵션에는 "상위 모델 + 일반 모델"만 노출 (하위 모델 제외)
    const selectableModels = useMemo(() => {
        const subModelIds = new Set(
            models
                .filter((model) => model.is_super_model && Array.isArray(model.sub_model_ids))
                .flatMap((model) => model.sub_model_ids ?? [])
        );

        return models.filter((model) => !subModelIds.has(model.id));
    }, [models]);

    const modelOptions = useMemo(
        () => selectableModels.map((model: ExtractionModel) => ({
            value: model.id,
            label: model.is_super_model ? `${model.name} (상위)` : model.name,
        })),
        [selectableModels]
    );

    // useQuery key includes all filter states
    const queryKey = ['extraction-logs-all', searchTerm, modelFilter, statusFilter];

    const {
        data,
        isLoading,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useInfiniteQuery({
        queryKey,
        queryFn: async ({ pageParam = 0 }) => {
            const params = new URLSearchParams({
                limit: PAGE_SIZE.toString(),
                offset: pageParam.toString()
            });
            if (searchTerm) params.append('filename', searchTerm);
            if (modelFilter !== 'all') params.append('modelId', modelFilter);
            if (statusFilter !== 'all') params.append('status', statusFilter);

            const res = await fetch(`/api/extraction/logs/all?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch logs');
            return await res.json() as ExtractionLog[];
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.length < PAGE_SIZE) return undefined;
            return allPages.length * PAGE_SIZE;
        },
        refetchInterval: 30000
    });

    const logs = useMemo(() => data?.pages.flat() || [], [data]);
    const logModelIds = useMemo(() => Array.from(new Set(logs.map(log => log.model_id).filter(Boolean))), [logs]);
    const { data: modelNameMapByLogs = {} } = useExtractionModelNameMapByIds(logModelIds);

    // 무한 스크롤 트리거
    const observerRef = useIntersectionObserver(([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    });

    // Normalized logs with model names
    const displayLogs = useMemo(() => {
        return logs.map(log => ({
            ...log,
            // Guard against null filename to fix toLowerCase error
            filename: log.filename || 'Untitled',
            model_name: modelNameMapByLogs[log.model_id] || log.model_name || log.model_id
        }));
    }, [logs, modelNameMapByLogs]);

    const handleView = (log: ExtractionLog) => {
        if (!log.model_id || !log.id) {
            toast.error('로그 정보를 확인할 수 없습니다.');
            return;
        }
        window.open(`/extraction/run/${log.model_id}?logId=${log.id}`, '_blank');
    };


    const handleDownload = (_log: ExtractionLog) => {
        toast.info('Excel 다운로드 기능은 준비 중입니다.');
    };

    const handleRetry = (_log: ExtractionLog) => {
        toast.info('다시 추출 기능은 준비 중입니다.');
    };

    const handleCancel = (_log: ExtractionLog) => {
        toast.info('작업 취소 기능은 준비 중입니다.');
    };

    const handleDelete = async (log: ExtractionLog) => {
        if (!log?.id) {
            toast.error('삭제할 기록 ID를 찾을 수 없습니다.');
            return;
        }

        const confirmed = window.confirm(`"${log.filename || 'Untitled'}" 추출 기록을 삭제하시겠습니까?`);
        if (!confirmed) return;

        try {
            await deleteExtractionLog(log.id);
            queryClient.setQueriesData(
                { queryKey: ['extraction-logs-all'] },
                (oldData: InfiniteData<ExtractionLog[]> | undefined) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        pages: oldData.pages.map((page) => page.filter((item) => item.id !== log.id))
                    };
                }
            );
            toast.success('추출 기록이 삭제되었습니다.');
            await queryClient.invalidateQueries({ queryKey: ['extraction-logs-all'] });
            await refetch();
        } catch (error: any) {
            toast.error(`삭제 실패: ${error?.message || '알 수 없는 오류'}`);
        }
    };

    return (
        <div className="flex-1 p-8 overflow-auto bg-background min-h-screen">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                                <Clock className="w-6 h-6 text-primary" />
                            </div>
                             <div>
                                <h1 className="text-2xl font-bold text-foreground">전체 추출 기록</h1>
                                <p className="text-sm text-muted-foreground">총 {displayLogs.length}개 검색됨</p>
                            </div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder="파일명 검색..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Combobox
                                value={modelFilter}
                                onChange={setModelFilter}
                                options={modelOptions}
                                placeholder="모든 모델"
                                searchPlaceholder="모델 검색"
                            />
                            <Button
                                variant={statusFilter === 'all' ? 'default' : 'outline'}
                                onClick={() => setStatusFilter('all')}
                            >
                                전체
                            </Button>
                            <Button
                                variant={statusFilter === 'processing' ? 'default' : 'outline'}
                                onClick={() => setStatusFilter('processing')}
                                className={statusFilter === 'processing' ? 'bg-chart-4 hover:bg-chart-4/90' : ''}
                            >
                                진행 중
                            </Button>
                            <Button
                                variant={statusFilter === 'success' ? 'default' : 'outline'}
                                onClick={() => setStatusFilter('success')}
                                className={statusFilter === 'success' ? 'bg-chart-2 hover:bg-chart-2/90' : ''}
                            >
                                성공
                            </Button>
                            <Button
                                variant={statusFilter === 'error' ? 'destructive' : 'outline'}
                                onClick={() => setStatusFilter('error')}
                            >
                                실패
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <Card className="overflow-hidden border-none shadow-none bg-card">
                    {isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <Clock className="w-12 h-12 mx-auto mb-3 animate-pulse text-primary" />
                                <p className="text-muted-foreground">기록을 불러오는 중...</p>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-destructive" />
                                <p className="text-foreground font-semibold">기록을 불러올 수 없습니다</p>
                            </div>
                        </div>
                    )}

                     {!isLoading && !error && (
                        <>
                            <ExtractionLogTable
                                logs={displayLogs}
                                showModelColumn={true}
                                onView={handleView}
                                onDownload={handleDownload}
                                onRetry={handleRetry}
                                onCancel={handleCancel}
                                onDelete={handleDelete}
                            />
                            {hasNextPage && (
                                <div ref={observerRef} className="flex justify-center p-6 border-t border-border">
                                    <Clock className="w-6 h-6 animate-spin text-primary" />
                                </div>
                            )}
                        </>
                    )}
                </Card>
            </div>
        </div>
    );
}
