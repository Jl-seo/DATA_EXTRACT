'use client';

import { useState } from 'react';
import { useExtractionModels } from '@/queries/extraction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    FileText,
    Search,
    Plus,
    Sparkles,
    Split,
    Layers,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSiteConfig } from '@/queries/env';
import { cn } from '@/lib/utils';

export function ModelGallery() {
    const { data: models, isLoading } = useExtractionModels({ offset: 0, pageSize: 1000 });
    const { data: siteConfig } = useSiteConfig();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'extraction' | 'comparison'>('all');
    const router = useRouter();

    // Identify all sub-models across all super models
    const subModelIds = new Set(models?.flatMap(m => m.sub_model_ids || []) || []);

    // Filter models (Apply show_in_gallery first and exclude sub-models)
    const galleryVisibleModels = models?.filter(m => m.show_in_gallery !== false && !subModelIds.has(m.id));

    const filteredModels = galleryVisibleModels?.filter(model =>
        model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const extractionModels = filteredModels?.filter(m => m.model_type !== 'comparison');
    const comparisonModels = filteredModels?.filter(m => m.model_type === 'comparison');

    const displayModels = activeTab === 'all' ? filteredModels
        : activeTab === 'extraction' ? extractionModels
            : comparisonModels;

    if (isLoading) {
        return <div className="flex-1 flex items-center justify-center">로딩 중...</div>;
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-background overflow-auto">
            {/* Header Section */}
            <div className="bg-card border-b border-border px-8 py-10">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Sparkles className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-foreground mb-1">{siteConfig?.app_name || 'DAOM'}</h1>
                            <p className="text-lg text-muted-foreground font-medium">{siteConfig?.app_description || 'AI 기반 문서 분석 플랫폼'}</p>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            size="lg"
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-6 shadow-md shadow-blue-600/20"
                            onClick={() => router.push('/admin/extraction-models')}
                        >
                            <Plus className="w-5 h-5 mr-2" /> 새 모델
                        </Button>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <div className="flex-1 px-8 py-8">
                <div className="max-w-7xl mx-auto">

                    {/* Toolbar */}
                    <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                        {/* Tabs */}
                        <div className="flex bg-muted p-1 rounded-lg border border-border shadow-sm">
                            <button
                                onClick={() => setActiveTab('all')}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                                    activeTab === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                전체 <span className="ml-1 text-xs opacity-70 bg-secondary px-1.5 py-0.5 rounded-full">{galleryVisibleModels?.length || 0}</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('extraction')}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                                    activeTab === 'extraction' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                추출 <span className="ml-1 text-xs opacity-70 bg-secondary px-1.5 py-0.5 rounded-full">{galleryVisibleModels?.filter(m => m.model_type !== 'comparison').length || 0}</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('comparison')}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                                    activeTab === 'comparison' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                비교 <span className="ml-1 text-xs opacity-70 bg-secondary px-1.5 py-0.5 rounded-full">{galleryVisibleModels?.filter(m => m.model_type === 'comparison').length || 0}</span>
                            </button>
                        </div>

                        {/* Search */}
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="모델 검색..."
                                className="pl-9 bg-card border-border focus-visible:ring-primary"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Grid */}
                    {displayModels?.length === 0 ? (
                        <div className="text-center py-20 bg-card rounded-2xl border border-dashed border-border">
                            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                                <Search className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-medium text-foreground mb-1">검색 결과가 없습니다</h3>
                            <p className="text-muted-foreground text-sm">다른 검색어나 필터를 시도해보세요</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {displayModels?.map((model) => {
                                const isComparison = model.model_type === 'comparison';
                                const isSuperModel = model.is_super_model;

                                return (
                                    <Link key={model.id} href={`/extraction/run/${model.id}`} className="block h-full">
                                        <div className={cn(
                                            "group h-full bg-card rounded-2xl border border-border p-6 transition-all duration-300 flex flex-col hover:shadow-lg",
                                            isSuperModel
                                                ? "hover:border-purple-500 hover:shadow-purple-500/5"
                                                : isComparison
                                                    ? "hover:border-rose-500 hover:shadow-rose-500/5"
                                                    : "hover:border-blue-500 hover:shadow-blue-500/5"
                                        )}>
                                            <div className="flex justify-between items-start mb-4">
                                                <div className={cn(
                                                    "w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300",
                                                    isSuperModel ? "bg-purple-500/10 text-purple-600" : isComparison ? "bg-rose-500/10 text-rose-600" : "bg-primary/10 text-primary"
                                                )}>
                                                    {isSuperModel ? <Layers className="w-6 h-6" /> : isComparison ? <Split className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                                                </div>
                                                <span className={cn(
                                                    "px-2.5 py-1 rounded-full text-xs font-semibold",
                                                    isSuperModel ? "bg-purple-500/20 text-purple-500" : isComparison ? "bg-rose-500/20 text-rose-500" : "bg-primary/20 text-primary"
                                                )}>
                                                    {isSuperModel ? '상위 모델' : isComparison ? '비교 분석' : '일반 추출'}
                                                </span>
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <h3 className={cn(
                                                    "text-lg font-bold text-foreground mb-2 truncate transition-colors",
                                                    isSuperModel ? "group-hover:text-purple-600" : isComparison ? "group-hover:text-rose-600" : "group-hover:text-blue-600"
                                                )}>
                                                    {model.name}
                                                </h3>
                                                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                                                    {model.description || '설명이 없습니다'}
                                                </p>
                                            </div>

                                            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded">
                                                    {model.fields?.length || 0}개 필드
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
