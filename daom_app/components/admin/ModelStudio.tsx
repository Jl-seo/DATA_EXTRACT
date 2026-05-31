'use client';

import { useExtractionModels, useDuplicateExtractionModel } from '@/queries/extraction';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Plus,
    LayoutTemplate,
    Split,
    Layers,
    Copy,
    Loader2,
} from 'lucide-react';
import { ModelEditor } from '@/components/extraction/ModelEditor';
import type { ExtractionModel } from '@/scheme/extractionModel';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect, useMemo, type FormEvent, type MouseEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/AuthClientChecker';

export function ModelStudio() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { data: models, isLoading } = useExtractionModels({ offset: 0, pageSize: 1000 });
    const [editingModel, setEditingModel] = useState<{ id?: string } | null>(null);
    const [copySourceModel, setCopySourceModel] = useState<ExtractionModel | null>(null);
    const [copyModelName, setCopyModelName] = useState('');
    const duplicateModel = useDuplicateExtractionModel();
    const { globalRole, modelRoles } = useAuth();
    const urlEditingModelId = searchParams.get('edit') || searchParams.get('modelId');
    const activeEditingModel = editingModel || (urlEditingModelId ? { id: urlEditingModelId } : null);

    const visibleModels = useMemo(() => {
        if (!models) return [];
        if (globalRole === 'admin') return models;

        return models.filter(model => {
            return modelRoles?.some(mr => mr.modelId === model.id && mr.role === 'Admin');
        });
    }, [models, globalRole, modelRoles]);

    // Diagnostic logging
    useEffect(() => {
        if (models) {
            console.log('--- Current Extraction Models ---');
            models.forEach(m => console.log(`ID: ${m.id}, Name: "${m.name}", Super: ${m.is_super_model}`));
        }
    }, [models]);

    const handleNewModel = () => {
        setEditingModel({});
    };

    const handleEditModel = (model: ExtractionModel) => {
        setEditingModel({ id: model.id });
    };

    const handleCopyClick = (event: MouseEvent, model: ExtractionModel) => {
        event.stopPropagation();
        setCopySourceModel(model);
        setCopyModelName(`${model.name} Copy`);
    };

    const handleCopyDialogOpenChange = (open: boolean) => {
        if (open) return;
        if (duplicateModel.isPending) return;
        setCopySourceModel(null);
        setCopyModelName('');
    };

    const handleDuplicateModel = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!copySourceModel) return;

        const nextName = copyModelName.trim();
        if (!nextName) {
            toast.error('복사할 모델 이름을 입력하세요.');
            return;
        }

        try {
            const copied = await duplicateModel.mutateAsync({
                sourceModelId: copySourceModel.id,
                name: nextName,
            });
            toast.success('모델이 복사되었습니다.');
            setCopySourceModel(null);
            setCopyModelName('');
            if (copied?.id) {
                setEditingModel({ id: copied.id });
            }
        } catch (error) {
            console.error('[ModelStudio] duplicate model failed:', error);
            toast.error('모델 복사에 실패했습니다.');
        }
    };

    const handleCloseEditor = () => {
        setEditingModel(null);
        // Clear search params when closing editor
        const params = new URLSearchParams(searchParams.toString());
        params.delete('edit');
        params.delete('modelId');
        const queryString = params.toString();
        router.replace(`/admin/model-studio${queryString ? `?${queryString}` : ''}`);
    };


    // Show editor if model is being edited
    if (activeEditingModel) {
        return <ModelEditor modelId={activeEditingModel.id} onClose={handleCloseEditor} />;
    }

    // Show gallery view
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-80px)] p-6 font-sans overflow-y-auto custom-scrollbar">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-foreground mb-1">모델 스튜디오</h2>
                    <p className="text-sm text-muted-foreground">추출 모델을 생성하고 관리하세요</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={handleNewModel} size="sm" className="bg-primary hover:bg-primary/90 shadow-md">
                        <Plus className="w-4 h-4 mr-2" />
                        새 모델 생성
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {visibleModels?.map((model) => {
                    const isComparison = model.model_type === 'comparison';
                    const isSuperModel = model.is_super_model;

                    return (
                        <div
                            key={model.id}
                            className="group cursor-pointer h-full"
                            onClick={() => handleEditModel(model)}
                        >
                            <div className={cn(
                                "relative p-[2px] rounded-2xl bg-gradient-to-br from-border to-border transition-all duration-300",
                                isSuperModel
                                    ? "hover:from-purple-500 hover:to-purple-400"
                                    : isComparison
                                        ? "hover:from-rose-500 hover:to-rose-400"
                                        : "hover:from-primary hover:to-chart-5"
                            )}>
                                <div className="bg-card rounded-2xl p-5 h-full transition-all duration-300 group-hover:shadow-xl relative overflow-hidden">
                                    {/* Type Badge */}
                                    <div className="absolute top-4 right-4 flex items-center gap-1.5 capitalize">
                                        {!isSuperModel && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 rounded-full bg-background/80 text-muted-foreground opacity-70 shadow-sm transition-opacity hover:bg-background hover:text-foreground active:bg-background focus-visible:bg-background focus-visible:text-foreground group-hover:opacity-100"
                                                onClick={(event) => handleCopyClick(event, model)}
                                                title="모델 복사"
                                            >
                                                <Copy className="h-3.5 w-3.5" />
                                                <span className="sr-only">모델 복사</span>
                                            </Button>
                                        )}
                                        <Badge
                                            variant="secondary"
                                            className={cn(
                                                "text-[9px] font-bold py-0 px-1.5",
                                                isSuperModel ? "bg-purple-100 text-purple-700 hover:bg-purple-100" :
                                                    isComparison ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"
                                            )}
                                        >
                                            {isSuperModel ? '상위 모델' : isComparison ? '비교 분석' : '일반 추출'}
                                        </Badge>
                                    </div>

                                    <div className="flex items-start justify-between mb-3">
                                        <div className={cn(
                                            "p-2.5 rounded-xl group-hover:scale-110 transition-transform",
                                            isSuperModel
                                                ? "bg-gradient-to-br from-purple-500/20 to-indigo-500/20 text-purple-600"
                                                : isComparison
                                                    ? "bg-gradient-to-br from-rose-500/20 to-orange-500/20 text-rose-600"
                                                    : "bg-gradient-to-br from-primary/20 to-chart-5/20 text-primary"
                                        )}>
                                            {isSuperModel ? <Layers className="w-5 h-5" /> : isComparison ? <Split className="w-5 h-5" /> : <LayoutTemplate className="w-5 h-5" />}
                                        </div>
                                    </div>
                                    <h3 className={cn(
                                        "font-bold text-base text-foreground mb-2 transition-colors truncate pr-28",
                                        "group-hover:text-primary",
                                        isSuperModel && "group-hover:text-purple-600",
                                        isComparison && "group-hover:text-rose-600"
                                    )}>
                                        {model.name}
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-4 line-clamp-2">
                                        {model.description || '설명 없음'}
                                    </p>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">{model.fields?.length || 0}개 필드</span>
                                        <span className={cn(
                                            "px-2 py-1 rounded-full font-medium",
                                            isSuperModel ? "bg-purple-100/50 text-purple-700" :
                                                isComparison ? "bg-rose-100/50 text-rose-700" : "bg-primary/10 text-primary"
                                        )}
                                        >
                                            {isSuperModel ? 'SUPER' : model.data_structure?.toUpperCase() || 'DATA'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <Dialog open={!!copySourceModel} onOpenChange={handleCopyDialogOpenChange}>
                <DialogContent>
                    <form onSubmit={handleDuplicateModel} className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>모델 복사</DialogTitle>
                            <DialogDescription>
                                원본 모델의 설정, 필드, 규칙, 참조 데이터, 엑셀 컬럼, 변환 설정을 모두 복사합니다.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-muted-foreground" htmlFor="copy-model-name">
                                새 모델 이름
                            </label>
                            <Input
                                id="copy-model-name"
                                value={copyModelName}
                                onChange={(event) => setCopyModelName(event.target.value)}
                                placeholder="새 모델 이름을 입력하세요"
                                autoFocus
                                disabled={duplicateModel.isPending}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleCopyDialogOpenChange(false)}
                                disabled={duplicateModel.isPending}
                            >
                                취소
                            </Button>
                            <Button type="submit" disabled={duplicateModel.isPending || !copyModelName.trim()}>
                                {duplicateModel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                복사
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
