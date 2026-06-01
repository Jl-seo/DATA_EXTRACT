'use client';

import { useState, useRef, useEffect } from 'react';
import {
    Split, FileDiff, CheckCircle2, ChevronRight, AlertCircle,
    Download, RefreshCw, ZoomIn, ZoomOut, RotateCcw,
    Maximize2, X, ChevronLeft, LayoutPanelLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PreviewData, ExtractionModel } from './types';

interface ComparisonReviewViewProps {
    previewData: PreviewData | null;
    model: ExtractionModel | null;
    baselineUrl: string | null;
    onRetry: () => void;
    onReset: () => void;
}

export function ComparisonReviewView({
    previewData,
    model,
    baselineUrl,
    onRetry,
    onReset
}: ComparisonReviewViewProps) {
    const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
    const [selectedDiffId, setSelectedDiffId] = useState<string | number | null>(null);
    const [zoom, setZoom] = useState(1);
    const [expandedImage, setExpandedImage] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const comparisons = previewData?.comparisons || [];
    const currentCandidate = comparisons[selectedCandidateIndex];
    const currentDifferences = currentCandidate?.result?.differences || [];
    const currentCandidateUrl = currentCandidate?.file_url;

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.2, 3));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 0.5));
    const handleResetZoom = () => setZoom(1);

    // CSV Export Handler (using what's available in daom_app)
    const handleExportCSV = () => {
        if (!comparisons || comparisons.length === 0) {
            toast.error('내보낼 데이터가 없습니다.');
            return;
        }

        try {
            let csvContent = "\uFEFF"; // UTF-8 BOM for Excel
            csvContent += "No.,비교 대상,페이지,유형,차이점 설명\n";

            let rowNum = 1;
            comparisons.forEach((comp, idx) => {
                if (comp.result?.differences) {
                    comp.result.differences.forEach(diff => {
                        const row = [
                            rowNum++,
                            `후보 ${idx + 1}`,
                            diff.page_number || '-',
                            diff.category || 'unknown',
                            `"${(diff.description || '').replace(/"/g, '""')}"`
                        ];
                        csvContent += row.join(",") + "\n";
                    });
                }
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `comparison_results_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.success('결과가 CSV 파일로 저장되었습니다.');
        } catch (err) {
            console.error('Export error:', err);
            toast.error('내보내기 실패');
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Header / Toolbar */}
            <div className="flex items-center justify-between px-6 py-3 border-b bg-card/50 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-sm">
                        <Split className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">비교 분석 결과 검토</h2>
                        <p className="text-xs text-muted-foreground">기준 문서와 비교 대상 간의 차이점을 분석했습니다.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border">
                        <Button variant="ghost" size="icon" onClick={handleZoomOut} disabled={zoom <= 0.5} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <ZoomOut className="w-4 h-4" />
                        </Button>
                        <span className="text-[11px] font-mono w-10 text-center font-bold">{Math.round(zoom * 100)}%</span>
                        <Button variant="ghost" size="icon" onClick={handleZoomIn} disabled={zoom >= 3} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <ZoomIn className="w-4 h-4" />
                        </Button>
                        <div className="border-l h-4 mx-1" />
                        <Button variant="ghost" size="sm" onClick={handleResetZoom} className="h-8 px-2 text-[10px] font-bold text-muted-foreground hover:text-foreground">
                            <RotateCcw className="w-3.5 h-3.5 mr-1" /> 리셋
                        </Button>
                    </div>

                    <div className="flex items-center gap-2 border-l pl-3">
                        <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-9 gap-2 font-semibold">
                            <Download className="w-4 h-4" /> 결과 내보내기
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onRetry} className="h-9 gap-2 text-muted-foreground">
                            <RefreshCw className="w-4 h-4" /> 재분석
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden relative">
                {/* 1. Candidate Selector Sidebar */}
                {comparisons.length > 1 && (
                    <div className={cn(
                        "border-r bg-muted/5 transition-all duration-300 flex flex-col shrink-0 overflow-hidden",
                        isSidebarOpen ? "w-[240px]" : "w-0"
                    )}>
                        <div className="p-4 border-b bg-background/50 flex items-center justify-between">
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">비교 대상 목록</span>
                            <Badge variant="secondary" className="text-[10px]">{comparisons.length}</Badge>
                        </div>
                        <ScrollArea className="flex-1">
                            <div className="p-3 space-y-2">
                                {comparisons.map((comp, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setSelectedCandidateIndex(idx)}
                                        className={cn(
                                            "w-full p-3 rounded-xl border text-left transition-all group relative overflow-hidden",
                                            selectedCandidateIndex === idx
                                                ? "bg-primary/5 border-primary shadow-sm ring-1 ring-primary/20"
                                                : "bg-background hover:border-primary/30 hover:bg-muted/30"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 relative z-10">
                                            <div className={cn(
                                                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                                selectedCandidateIndex === idx ? "bg-primary text-white" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                            )}>
                                                <span className="text-xs font-bold">{idx + 1}</span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className={cn(
                                                    "text-sm font-semibold truncate",
                                                    selectedCandidateIndex === idx ? "text-primary" : "text-foreground"
                                                )}>
                                                    후보 문서 {idx + 1}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                                                    차이점 {comp.result?.differences?.length || 0}건
                                                </p>
                                            </div>
                                            {comp.error && <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                )}

                {/* Sidebar Toggle Button */}
                {comparisons.length > 1 && (
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="absolute left-[calc(var(--sidebar-width))] top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-12 bg-background border rounded-full shadow-md z-20 flex items-center justify-center hover:bg-muted transition-colors group"
                        style={{ '--sidebar-width': isSidebarOpen ? '240px' : '0px' } as any}
                    >
                        {isSidebarOpen ? <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary" /> : <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />}
                    </button>
                )}

                {/* 2. Main Comparison View (Side-by-Side) */}
                <div className="flex-1 flex gap-4 p-4 overflow-hidden bg-muted/20">
                    {/* Baseline View */}
                    <Card className="flex-1 flex flex-col overflow-hidden border-2 shadow-sm relative group">
                        <div className="shrink-0 px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-widest">
                                <span className="w-2 h-2 rounded-full bg-blue-500" /> 기준 문서 (Baseline)
                            </span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => baselineUrl && setExpandedImage(baselineUrl)}>
                                <Maximize2 className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                        <div className="flex-1 overflow-auto relative p-4 bg-white/50 pattern-grid-lg">
                            <div
                                className="transition-transform duration-200 ease-out origin-top-left flex items-center justify-center min-h-full"
                                style={{ transform: `scale(${zoom})` }}
                            >
                                {baselineUrl ? (
                                    <img
                                        src={baselineUrl}
                                        alt="Baseline"
                                        className="max-w-full h-auto shadow-2xl rounded-sm border select-none"
                                        draggable={false}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-3 opacity-30">
                                        <FileDiff className="w-12 h-12" />
                                        <span className="text-sm font-medium">문서를 불러올 수 없습니다</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Candidate View */}
                    <Card className="flex-1 flex flex-col overflow-hidden border-2 shadow-sm relative group">
                        <div className="shrink-0 px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-widest">
                                <span className="w-2 h-2 rounded-full bg-amber-500" /> 후보 문서 {selectedCandidateIndex + 1} (Candidate)
                            </span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => currentCandidateUrl && setExpandedImage(currentCandidateUrl)}>
                                <Maximize2 className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                        <div className="flex-1 overflow-auto relative p-4 bg-white/50 pattern-grid-lg">
                            <div
                                className="transition-transform duration-200 ease-out origin-top-left flex items-center justify-center min-h-full"
                                style={{ transform: `scale(${zoom})` }}
                            >
                                {currentCandidateUrl ? (
                                    <img
                                        src={currentCandidateUrl}
                                        alt="Candidate"
                                        className="max-w-full h-auto shadow-2xl rounded-sm border select-none"
                                        draggable={false}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-3 opacity-30 text-destructive">
                                        <AlertCircle className="w-12 h-12" />
                                        <span className="text-sm font-medium">분석 데이터가 누락되었습니다</span>
                                    </div>
                                )}
                            </div>

                            {/* Error Overlay */}
                            {currentCandidate?.error && (
                                <div className="absolute inset-0 bg-destructive/10 backdrop-blur-[1px] flex items-center justify-center p-6 text-center z-30 font-medium">
                                    <div className="bg-background border-2 border-destructive rounded-2xl p-6 shadow-2xl max-w-xs animate-in zoom-in-95 duration-300">
                                        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mx-auto mb-4">
                                            <AlertCircle className="w-6 h-6" />
                                        </div>
                                        <h4 className="text-destructive font-bold mb-2">분석 오류 발생</h4>
                                        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">{currentCandidate.error}</p>
                                        <Button variant="outline" size="sm" onClick={onRetry} className="w-full text-xs font-bold border-destructive text-destructive hover:bg-destructive hover:text-white">다시 시도하기</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>

                {/* 3. Analysis Results Sidebar */}
                <div className="w-[360px] border-l bg-card flex flex-col shrink-0 overflow-hidden shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.05)]">
                    <div className="p-5 border-b shrink-0 bg-muted/20">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-chart-1/10 text-chart-1">
                                    <FileDiff className="w-4 h-4" />
                                </div>
                                <h3 className="text-sm font-bold tracking-tight">차이점 분석 결과</h3>
                            </div>
                            <Badge variant="outline" className="text-[10px] px-2 py-0 border-primary/20 text-primary bg-primary/5">
                                총 {currentDifferences.length}건
                            </Badge>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-background border rounded-lg p-2.5 flex flex-col items-center">
                                <span className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">내용 차이</span>
                                <span className="text-sm font-bold mt-0.5">{currentDifferences.filter(d => d.category === 'content').length}건</span>
                            </div>
                            <div className="bg-background border rounded-lg p-2.5 flex flex-col items-center">
                                <span className="text-[9px] font-bold text-muted-foreground uppercase opacity-60">레이아웃 차이</span>
                                <span className="text-sm font-bold mt-0.5">{currentDifferences.filter(d => d.category === 'layout').length}건</span>
                            </div>
                        </div>
                    </div>

                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 space-y-3">
                            {currentDifferences.length === 0 && !currentCandidate?.error && (
                                <div className="flex flex-col items-center justify-center py-16 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="w-16 h-16 rounded-full bg-chart-2/10 flex items-center justify-center text-chart-2 mb-4">
                                        <CheckCircle2 className="w-8 h-8" />
                                    </div>
                                    <h4 className="text-sm font-bold text-foreground">차이점 없음</h4>
                                    <p className="text-xs text-muted-foreground mt-2 max-w-[180px] leading-relaxed">
                                        두 문서가 완벽히 일치하거나<br />지정된 규칙 내에서 차이점이 발견되지 않았습니다.
                                    </p>
                                </div>
                            )}

                            {currentDifferences.map((diff) => (
                                <div
                                    key={diff.id}
                                    onClick={() => setSelectedDiffId(selectedDiffId === diff.id ? null : diff.id)}
                                    className={cn(
                                        "group p-4 rounded-xl border transition-all cursor-pointer relative",
                                        selectedDiffId === diff.id
                                            ? "bg-card border-primary shadow-lg ring-1 ring-primary/20 ring-offset-2 scale-[1.02] z-10"
                                            : "bg-background hover:bg-muted/10 hover:border-primary/40 hover:shadow-sm"
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex gap-1.5 items-center">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "text-[9px] font-bold px-1.5 py-0 uppercase transition-colors",
                                                    diff.category === 'content' ? "border-red-200 bg-red-50 text-red-600" :
                                                        diff.category === 'layout' ? "border-blue-200 bg-blue-50 text-blue-600" :
                                                            "border-muted bg-muted/50 text-muted-foreground"
                                                )}
                                            >
                                                {diff.category === 'content' ? '내용' : diff.category === 'layout' ? '레이아웃' : diff.category}
                                            </Badge>
                                            {diff.page_number && (
                                                <span className="text-[9px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-muted-foreground/10">
                                                    P. {diff.page_number}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[9px] font-mono font-medium text-muted-foreground opacity-40">#{diff.id}</span>
                                    </div>
                                    <p className="text-[13px] text-foreground leading-relaxed font-medium">
                                        {diff.description}
                                    </p>

                                    <div className={cn(
                                        "mt-3 pt-3 border-t flex items-center justify-between transition-all duration-300",
                                        selectedDiffId === diff.id ? "opacity-100 max-h-10" : "opacity-0 max-h-0 pointer-events-none overflow-hidden"
                                    )}>
                                        <span className="text-[10px] font-bold text-primary flex items-center">
                                            위치 확인 <ChevronRight className="w-3 h-3 ml-1" />
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>

                    <div className="p-4 bg-muted/10 border-t mt-auto shrink-0">
                        <Button variant="default" className="w-full font-bold shadow-md shadow-primary/10" onClick={onReset}>
                            <CheckCircle2 className="w-4 h-4 mr-2" /> 확인 완료
                        </Button>
                    </div>
                </div>
            </div>

            {/* Full Screen Image Modal */}
            {expandedImage && (
                <div
                    className="fixed inset-0 bg-background/95 backdrop-blur-md z-[100] flex items-center justify-center p-8 animate-in fade-in duration-300"
                    onClick={() => setExpandedImage(null)}
                >
                    <div className="relative w-full h-full flex items-center justify-center max-w-screen-2xl mx-auto shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <img
                            src={expandedImage}
                            alt="Expanded"
                            className="max-w-full max-h-full object-contain pointer-events-none"
                        />
                        <div className="absolute top-6 left-6 flex items-center gap-2 bg-background/80 backdrop-blur px-3 py-1.5 rounded-full border shadow-sm">
                            <LayoutPanelLeft className="w-4 h-4 text-primary" />
                            <span className="text-xs font-bold tracking-tight">전체 화면 보기</span>
                        </div>
                        <Button
                            variant="secondary"
                            size="icon"
                            className="absolute top-6 right-6 rounded-full h-10 w-10 border shadow-md hover:bg-destructive hover:text-white transition-all scale-100 hover:scale-110"
                            onClick={(e) => { e.stopPropagation(); setExpandedImage(null); }}
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
