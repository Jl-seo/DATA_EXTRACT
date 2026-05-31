'use client';

import { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Highlight } from './types';

interface PDFViewerProps {
    fileUrl: string;
    highlights?: Highlight[];
    activeFieldKey?: string | null;
    ocrEngine?: string;
    onHighlightClick?: (fieldKey: string) => void;
}

// PDF.js worker setup
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface PDFViewerHandle {
    scrollToHighlight: (fieldKey: string) => void;
}

/**
 * PDF 원본 페이지 크기(포인트 단위)를 기반으로 bbox 좌표를 퍼센트로 변환
 */
function bboxToPercent(
    bbox: { x1: number; y1: number; width: number; height: number },
    pageWidthPt: number,
    pageHeightPt: number,
    ocrEngine?: string
): { left: string; top: string; width: string; height: string } {
    const maxVal = Math.max(bbox.x1, bbox.y1, bbox.x1 + bbox.width, bbox.y1 + bbox.height);
    const normalizedEngine = (ocrEngine || '').toLowerCase();
    const isCuEngine = normalizedEngine === 'cu' || normalizedEngine === 'content_understanding';
    const allWithinRatio =
        bbox.x1 >= 0 && bbox.y1 >= 0 &&
        (bbox.x1 + bbox.width) <= 1.01 &&
        (bbox.y1 + bbox.height) <= 1.01;

    // 0~1 비율 좌표는 CU에서만 허용 (DI 오인 방지)
    if (isCuEngine && allWithinRatio) {
        return {
            left: `${bbox.x1 * 100}%`,
            top: `${bbox.y1 * 100}%`,
            width: `${bbox.width * 100}%`,
            height: `${bbox.height * 100}%`,
        };
    }

    // 백엔드에서 이미 0-100% 비율로 정규화된 경우 처리 (LayoutParser 등에서 정규화됨)
    // x1, y1, width, height가 모두 0-101 범위 내에 있으면 퍼센트로 간주
    if (bbox.x1 >= 0 && bbox.x1 <= 101 && bbox.y1 >= 0 && bbox.y1 <= 101 &&
        (bbox.x1 + bbox.width) <= 101 && (bbox.y1 + bbox.height) <= 101) {
        return {
            left: `${bbox.x1}%`,
            top: `${bbox.y1}%`,
            width: `${bbox.width}%`,
            height: `${bbox.height}%`,
        };
    }

    // 하위 호환성 및 폴백 처리:
    const pageWidthInch = pageWidthPt / 72;
    const pageHeightInch = pageHeightPt / 72;

    // 1. 인치 단위 (보통 최대 20인치 이내)
    if (maxVal <= 20) {
        return {
            left: `${(bbox.x1 / pageWidthInch) * 100}%`,
            top: `${(bbox.y1 / pageHeightInch) * 100}%`,
            width: `${(bbox.width / pageWidthInch) * 100}%`,
            height: `${(bbox.height / pageHeightInch) * 100}%`,
        };
    }

    // 2. 포인트 단위 (0-1000+)
    return {
        left: `${(bbox.x1 / pageWidthPt) * 100}%`,
        top: `${(bbox.y1 / pageHeightPt) * 100}%`,
        width: `${(bbox.width / pageWidthPt) * 100}%`,
        height: `${(bbox.height / pageHeightPt) * 100}%`,
    };
}

function polygonToPercentPoints(
    polygon: number[] | undefined,
    pageWidthPt: number,
    pageHeightPt: number,
    ocrEngine?: string
): string | null {
    if (!Array.isArray(polygon) || polygon.length < 8) return null;

    const numbers = polygon.filter((value): value is number => Number.isFinite(value));
    if (numbers.length < 8) return null;

    const maxVal = Math.max(...numbers);
    const normalizedEngine = (ocrEngine || '').toLowerCase();
    const isCuEngine = normalizedEngine === 'cu' || normalizedEngine === 'content_understanding';
    const isRatio = numbers.every((value) => value >= 0 && value <= 1.01);
    const isPercent = numbers.every((value) => value >= 0 && value <= 101);

    const toPercent = (x: number, y: number): [number, number] => {
        // 0~1 비율 좌표는 CU에서만 허용 (DI 오인 방지)
        if (isCuEngine && isRatio) return [x * 100, y * 100];
        if (isPercent) return [x, y];

        const pageWidthInch = pageWidthPt / 72;
        const pageHeightInch = pageHeightPt / 72;
        if (maxVal <= 20) {
            return [(x / pageWidthInch) * 100, (y / pageHeightInch) * 100];
        }

        return [(x / pageWidthPt) * 100, (y / pageHeightPt) * 100];
    };

    const points: string[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
        const [px, py] = toPercent(numbers[i], numbers[i + 1]);
        points.push(`${px},${py}`);
    }

    return points.length >= 4 ? points.join(' ') : null;
}

export const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(({
    fileUrl,
    highlights = [],
    activeFieldKey,
    ocrEngine,
    onHighlightClick
}, ref) => {
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState<number>(1.2);
    const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
    const containerRef = useRef<HTMLDivElement>(null);

    // 각 페이지 렌더링 성공 시 원본 크기 저장
    const onPageRenderSuccess = useCallback((pageNum: number, page: { originalWidth: number; originalHeight: number }) => {
        setPageSizes(prev => ({
            ...prev,
            [pageNum]: { width: page.originalWidth, height: page.originalHeight }
        }));
    }, []);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        scrollToHighlight: (fieldKey: string) => {
            const target = highlights.find(h => h.fieldKey === fieldKey);
            if (target) {
                setTimeout(() => {
                    const el = document.getElementById(`highlight-${fieldKey}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                        el.style.boxShadow = '0 0 0 4px rgba(250, 204, 21, 0.8)';
                        setTimeout(() => {
                            el.style.transition = 'box-shadow 0.5s ease-out';
                            el.style.boxShadow = 'none';
                        }, 1000);
                    }
                }, 200);
            }
        }
    }), [highlights]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
    };

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.2, 3));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.5));
    const handleResetZoom = () => setScale(1.2);

    return (
        <div className="flex flex-col h-full bg-muted/30 rounded-lg overflow-hidden border">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-background border-b z-10">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                        {numPages > 0 ? `총 ${numPages} 페이지` : '-'}
                    </span>
                </div>

                <div className="flex items-center gap-1 border-l pl-4">
                    <Button variant="ghost" size="icon" onClick={handleZoomOut} className="h-8 w-8">
                        <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-[10px] font-medium w-12 text-center text-muted-foreground">
                        {(scale * 100).toFixed(0)}%
                    </span>
                    <Button variant="ghost" size="icon" onClick={handleZoomIn} className="h-8 w-8">
                        <ZoomIn className="w-4 h-4" />
                    </Button>
                    <div className="border-l mx-1 h-4" />
                    <Button variant="ghost" size="icon" onClick={handleResetZoom} className="h-8 w-8" title="초기화">
                        <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>

            {/* Viewer Area - 스크롤 방식으로 전체 페이지 렌더링 */}
            <div className="flex-1 overflow-auto p-4 bg-muted/20" ref={containerRef}>
                <Document
                    file={fileUrl}
                    className="flex flex-col gap-4 w-fit mx-auto"
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(error) => console.error('[PDFViewer] Document load error:', error)}
                    loading={
                        <div className="flex flex-col items-center justify-center p-20 gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">PDF 로딩 중...</p>
                        </div>
                    }
                    error={
                        <div className="p-10 text-center text-destructive">
                            PDF를 불러올 수 없습니다.
                        </div>
                    }
                >
                    {Array.from({ length: numPages }, (_, i) => {
                        const pageNum = i + 1;
                        const pageHighlights = highlights.filter(h => h.pageIndex === i);
                        const pageSize = pageSizes[pageNum] || { width: 612, height: 792 };

                        return (
                            <div key={pageNum} className="relative shadow-2xl border bg-white">
                                <Page
                                    pageNumber={pageNum}
                                    scale={scale}
                                    renderAnnotationLayer={false}
                                    renderTextLayer={true}
                                    onRenderSuccess={(page) => onPageRenderSuccess(pageNum, page)}
                                />

                                {/* 페이지별 하이라이트 오버레이 */}
                                {pageHighlights.length > 0 && (
                                    <div className="absolute inset-0 pointer-events-none z-10">
                                        {pageHighlights.map((area, idx) => {
                                            const isActive = area.fieldKey === activeFieldKey;
                                            const hasActive = !!activeFieldKey;
                                            const isDimmed = hasActive && !isActive;

                                            const style = bboxToPercent(
                                                area.position.boundingRect,
                                                pageSize.width,
                                                pageSize.height,
                                                ocrEngine
                                            );
                                            const polygonPoints = polygonToPercentPoints(
                                                area.position.polygon,
                                                pageSize.width,
                                                pageSize.height,
                                                ocrEngine
                                            );
                                            const isPolygon = polygonPoints !== null;

                                            return (
                                                <div
                                                    key={idx}
                                                    id={`highlight-${area.fieldKey}`}
                                                    className={cn(
                                                        'absolute transition-all duration-300 ease-out group',
                                                        isActive ? 'z-50' : 'z-10 hover:z-20',
                                                        isPolygon ? 'pointer-events-none' : 'cursor-pointer pointer-events-auto',
                                                        isDimmed ? 'opacity-40 grayscale' : 'opacity-100'
                                                    )}
                                                    style={isPolygon ? { left: 0, top: 0, width: '100%', height: '100%' } : style}
                                                    title={area.content}
                                                    onClick={!isPolygon ? (e) => {
                                                        e.stopPropagation();
                                                        if (area.fieldKey) {
                                                            onHighlightClick?.(area.fieldKey);
                                                        }
                                                    } : undefined}
                                                >
                                                    {isPolygon ? (
                                                        <svg className="absolute inset-0 w-full h-full overflow-visible">
                                                            <polygon
                                                                points={polygonPoints}
                                                                className={cn(
                                                                    'transition-all duration-300 pointer-events-auto cursor-pointer',
                                                                    isActive
                                                                        ? 'fill-yellow-400/35 stroke-yellow-500 [stroke-width:0.6]'
                                                                        : 'fill-yellow-300/25 stroke-yellow-500 [stroke-width:0.45]'
                                                                )}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (area.fieldKey) {
                                                                        onHighlightClick?.(area.fieldKey);
                                                                    }
                                                                }}
                                                            />
                                                        </svg>
                                                    ) : (
                                                        <div
                                                            className={cn(
                                                                'absolute -inset-1 rounded-[3px]',
                                                                isActive
                                                                    ? 'bg-yellow-400/40 border-[3px] border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.8)]'
                                                                    : 'bg-yellow-300/30 border-2 border-yellow-500 hover:bg-yellow-400/50 hover:border-yellow-600'
                                                            )}
                                                        />
                                                    )}

                                                    {(isActive || !hasActive) && (
                                                        <div className={cn(
                                                            'absolute px-1.5 py-0.5 text-[10px] font-bold text-white bg-yellow-600 rounded shadow-sm',
                                                            'opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none',
                                                            isActive && 'opacity-100'
                                                        )} style={isPolygon ? { left: style.left, top: `calc(${style.top} - 1.5rem)` } : { left: 0, top: '-1.5rem' }}>
                                                            {area.fieldKey}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* 페이지 번호 표시 */}
                                <div className="absolute bottom-2 right-3 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none">
                                    {pageNum} / {numPages}
                                </div>
                            </div>
                        );
                    })}
                </Document>
            </div>
        </div>
    );
});

PDFViewer.displayName = 'PDFViewer';
