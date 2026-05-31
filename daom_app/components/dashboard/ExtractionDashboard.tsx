'use client';

import { useState } from 'react';
import { useExtractionModels } from '@/queries/extraction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    FileText,
    Search,
    ArrowRight,
    Loader2,
    LayoutTemplate,
    Split,
    Layers,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function ExtractionDashboard() {
    const { data: models, isLoading } = useExtractionModels({ offset: 0, pageSize: 1000 });
    const [searchQuery, setSearchQuery] = useState('');
    const router = useRouter();

    // Identify all sub-models across all super models
    const subModelIds = new Set(models?.flatMap(m => m.sub_model_ids || []) || []);

    // Filter models (exclude models that are sub-models of any super model)
    const filteredModels = models?.filter(model => {
        const isSubModel = subModelIds.has(model.id);
        const matchesQuery = model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            model.description?.toLowerCase().includes(searchQuery.toLowerCase());
        return !isSubModel && matchesQuery;
    });

    const handleSelectModel = (modelId: string) => {
        router.push(`/extraction/run/${modelId}`);
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="flex-1 p-8 overflow-auto bg-background">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h2 className="text-3xl font-black text-foreground mb-2">문서 추출</h2>
                    <p className="text-muted-foreground">모델을 선택하여 문서에서 데이터를 추출하세요</p>
                </div>

                {/* Search */}
                <div className="mb-6">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="모델 검색..."
                            className="pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Model Grid */}
                {!filteredModels || filteredModels.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-6 bg-muted rounded-2xl flex items-center justify-center">
                            <LayoutTemplate className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold text-foreground mb-2">아직 생성된 모델이 없습니다</h3>
                        <p className="text-muted-foreground mb-6">먼저 모델 스튜디오에서 추출 모델을 만들어보세요</p>
                        <Button onClick={() => router.push('/admin/extraction-models')}>
                            모델 만들기
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredModels?.map((model) => {
                            const isComparison = model.model_type === 'comparison';
                            const isSuperModel = model.is_super_model;

                            return (
                                <button
                                    key={model.id}
                                    onClick={() => handleSelectModel(model.id)}
                                    className={cn(
                                        "group bg-card p-6 rounded-2xl border-2 border-border transition-all text-left relative overflow-hidden",
                                        "hover:border-primary hover:shadow-xl",
                                        isComparison && "hover:border-rose-500",
                                        isSuperModel && "hover:border-purple-500 shadow-purple-500/10"
                                    )}
                                >
                                    {/* Type Badge */}
                                    <div className="absolute top-4 right-4 capitalize">
                                        <Badge
                                            variant="secondary"
                                            className={cn(
                                                "text-[10px] font-bold py-0 px-2",
                                                isSuperModel ? "bg-purple-100 text-purple-700 hover:bg-purple-100" :
                                                    isComparison ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-blue-100 text-blue-700 hover:bg-blue-100"
                                            )}
                                        >
                                            {isSuperModel ? '상위 모델' : isComparison ? '비교 분석' : '일반 추출'}
                                        </Badge>
                                    </div>

                                    <div className="flex items-start gap-4 mb-4">
                                        <div className={cn(
                                            "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform",
                                            isSuperModel
                                                ? "bg-gradient-to-br from-purple-500/20 to-indigo-500/20 text-purple-600"
                                                : isComparison
                                                    ? "bg-gradient-to-br from-rose-500/20 to-orange-500/20 text-rose-600"
                                                    : "bg-gradient-to-br from-primary/20 to-chart-5/20 text-primary"
                                        )}>
                                            {isSuperModel ? <Layers className="w-6 h-6" /> : isComparison ? <Split className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                                        </div>
                                        <div className="flex-1 min-w-0 pr-12">
                                            <h3 className={cn(
                                                "text-lg font-bold text-foreground mb-1 transition-colors truncate",
                                                "group-hover:text-primary",
                                                isSuperModel && "group-hover:text-purple-600",
                                                isComparison && "group-hover:text-rose-600"
                                            )}>
                                                {model.name}
                                            </h3>
                                            <p className="text-sm text-muted-foreground line-clamp-2">
                                                {model.description || '설명 없음'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Field Count */}
                                    <div className="flex items-center justify-between text-sm mb-3">
                                        <span className="text-muted-foreground">
                                            {model.fields?.length || 0}개 추출 필드
                                        </span>
                                        {model.data_structure && (
                                            <span className={cn(
                                                "px-2 py-1 rounded-full font-medium text-xs",
                                                isSuperModel ? "bg-purple-100/50 text-purple-700" :
                                                    isComparison ? "bg-rose-100/50 text-rose-700" : "bg-primary/10 text-primary"
                                            )}>
                                                {isSuperModel ? 'SUPER' : model.data_structure.toUpperCase()}
                                            </span>
                                        )}
                                    </div>

                                    {/* Action Hint */}
                                    <div className={cn(
                                        "flex items-center font-medium text-sm pt-3 border-t border-border transition-colors",
                                        "text-primary",
                                        isSuperModel && "text-purple-600",
                                        isComparison && "text-rose-600"
                                    )}>
                                        {isSuperModel ? '상위 모델 추출 시작' : isComparison ? '비교 분석 시작하기' : '문서 업로드하기'}
                                        <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
