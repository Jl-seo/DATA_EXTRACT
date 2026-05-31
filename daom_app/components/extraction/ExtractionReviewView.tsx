'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    CheckCircle, Save, RefreshCw, Loader2,
    Copy, Trash2, Plus, History, FileJson, Settings,
    AlertCircle, Send, Edit, ChevronDown, ChevronRight, ChevronLeft, TableProperties, Maximize2, Minimize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { PreviewData, ExtractionModel, Highlight } from './types';
import { getConfidenceColor } from './constants';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

import { OcrTextViewer } from './viewers/OcrTextViewer';
import { ExcelGridViewer } from './viewers/ExcelGridViewer';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import dayjs from 'dayjs';

const PDFViewer = dynamic(
    () => import('./PDFViewer').then(mod => mod.PDFViewer),
    {
        ssr: false,
        loading: () => (
            <div className="h-full flex flex-col items-center justify-center p-20 gap-3 bg-muted/20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">PDF 뷰어 로딩 중...</p>
            </div>
        )
    }
);

import { type PDFViewerHandle } from './PDFViewer';
import { getFileSasUrl } from '@/actions/file';
import { getExtractionModel } from '@/actions/extractionModel';
import { hasStrictTableSchema, resolveStrictTableColumnKeys } from './tableSchema';
import { getStickyTableClasses } from './tableStickyStyles';

const METADATA_KEYS = [
    'bbox',
    'page_number',
    'confidence',
    'type',
    'source_text',
    '_row_confidence',
    '_source_table_index',
    '_source_row_index',
    '_row_bbox',
    '_row_page_number'
];
const SYSTEM_RESULT_KEYS = new Set(['other_data']);
const EMPTY_OBJ = {};
type TableCellPoint = { rowIndex: number; colKey: string };
type ModalPosition = { left: number; top: number };

// Helper to safely extract value from rich object { value: any, confidence: ... }
const getDisplayValue = (v: any) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

// Helper to wrap new value back into rich object structure if it was there
const wrapValue = (oldV: any, newV: any) => (oldV && typeof oldV === 'object' && 'value' in oldV ? { ...oldV, value: newV } : newV);

const getRowConfidence = (row: any): number | null => {
    if (!row || typeof row !== 'object') return null;
    const raw = row._row_confidence;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    return raw > 1 ? Math.min(raw / 100, 1) : Math.max(0, Math.min(raw, 1));
};

const getRowConfidenceClass = (confidence: number): string => {
    if (confidence >= 0.9) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (confidence >= 0.7) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
};

const buildRowHighlight = (fieldKey: string, row: any, rowIndex: number): Highlight | null => {
    if (!row || typeof row !== 'object' || !Array.isArray(row._row_bbox)) return null;
    const points = row._row_bbox as number[];
    if (points.length < 4) return null;

    let x1 = points[0], y1 = points[1], x2 = points[2], y2 = points[3];
    if (points.length > 4) {
        const xs = points.filter((_: number, i: number) => i % 2 === 0);
        const ys = points.filter((_: number, i: number) => i % 2 === 1);
        x1 = Math.min(...xs); x2 = Math.max(...xs);
        y1 = Math.min(...ys); y2 = Math.max(...ys);
    }

    return {
        fieldKey,
        content: `${fieldKey} ${rowIndex + 1}행`,
        pageIndex: Number(row._row_page_number || 1) - 1,
        position: {
            boundingRect: {
                x1,
                y1,
                x2,
                y2,
                width: x2 - x1,
                height: y2 - y1
            }
        }
    };
};

// Helper to format complex nested values (Array/Object) into readable strings
const formatNestedValue = (v: any): string => {
    const val = getDisplayValue(v);
    if (val === null || val === undefined) return "";
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);

    if (Array.isArray(val)) {
        return val.map(item => formatNestedValue(item)).filter(s => s !== "").join(', ');
    }

    if (typeof val === 'object') {
        if ('value' in val && val.value !== undefined) return formatNestedValue(val.value);
        if ('name' in val && val.name !== undefined) return formatNestedValue(val.name);
        if ('text' in val && val.text !== undefined) return formatNestedValue(val.text);

        const entries = Object.entries(val).filter(([k]) => !METADATA_KEYS.includes(k));
        if (entries.length > 0) {
            return entries.map(([k, sv]) => `${k}: ${formatNestedValue(sv)}`).join(' | ');
        }
        return JSON.stringify(val);
    }
    return String(val);
};

const removeSystemResultKeys = (data: Record<string, any> | null | undefined): Record<string, any> => {
    if (!data) return {};
    return Object.fromEntries(
        Object.entries(data).filter(([key]) => !SYSTEM_RESULT_KEYS.has(key.toLowerCase()))
    );
};

const getFileType = (file: File | null, fileUrl: string | null, filenameHint?: string | null) => {
    const name = file?.name || filenameHint || '';
    const lowerName = name.toLowerCase();
    if (lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.csv')) return 'excel';
    return 'image';
};

const MAX_LLM_REQUEST_VIEWER_CHARS = 500000;

const clampViewerText = (text: string): { text: string; truncated: boolean } => {
    if (text.length > MAX_LLM_REQUEST_VIEWER_CHARS) {
        return {
            text: text.slice(0, MAX_LLM_REQUEST_VIEWER_CHARS),
            truncated: true,
        };
    }

    return {
        text,
        truncated: false,
    };
};

const stripCoordinateBracketsForViewer = (text: string): string => (
    text
        .replace(/\[\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\\n[ \t]+/g, '\\n')
);

const normalizeFieldKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const findFieldDefByKey = (model: any, key: string): any | undefined => {
    const fields = model?.fields;
    if (!Array.isArray(fields) || !key) return undefined;
    const direct = fields.find((f: any) => f?.key === key);
    if (direct) return direct;
    const normalized = normalizeFieldKey(key);
    return fields.find((f: any) => normalizeFieldKey(String(f?.key || '')) === normalized);
};
const isEmptyLegacyRow = (row: unknown): boolean => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const keys = Object.keys(row as Record<string, unknown>).filter((k) => !METADATA_KEYS.includes(k));
    return keys.length === 0;
};

// --- Memoized Sub-components ---

const EditableTable = memo(({
    fieldKey,
    fieldValue,
    displayValue,
    model,
    colWidths,
    isCollapsed,
    toggleFieldCollapse,
    startColResize,
    handleRowAdd,
    handleRowDelete,
    handleTableChange,
    handleTablePaste,
    handleTableBulkClear,
    handleRowHighlight
}: any) => {
    // 1. Initialize data keys at the very beginning to avoid ReferenceErrors
    const fieldDef = findFieldDefByKey(model, fieldKey);
    const valueSubFields = Array.isArray(fieldValue?.sub_fields) ? fieldValue.sub_fields : [];
    const hasSubFields = hasStrictTableSchema(fieldDef?.sub_fields, valueSubFields);
    const keys = resolveStrictTableColumnKeys(fieldDef?.sub_fields, valueSubFields);

    // --- Scroll Sync Refs ---
    const topScrollRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const [innerTableWidth, setInnerTableWidth] = useState(0);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const [anchorCell, setAnchorCell] = useState<TableCellPoint | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null);
    const isDragSelectingRef = useRef(false);
    const modalDragRef = useRef<{ active: boolean; pointerOffsetX: number; pointerOffsetY: number }>({
        active: false,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
    });

    const toCellKey = useCallback((rowIndex: number, colKey: string) => `${rowIndex}::${colKey}`, []);
    const isCellSelected = useCallback((rowIndex: number, colKey: string) => {
        return selectedCells.has(toCellKey(rowIndex, colKey));
    }, [selectedCells, toCellKey]);

    const buildRectSelection = useCallback((from: TableCellPoint, to: TableCellPoint): Set<string> => {
        const next = new Set<string>();
        const colFrom = keys.indexOf(from.colKey);
        const colTo = keys.indexOf(to.colKey);
        if (colFrom < 0 || colTo < 0) return next;

        const rowStart = Math.min(from.rowIndex, to.rowIndex);
        const rowEnd = Math.max(from.rowIndex, to.rowIndex);
        const colStart = Math.min(colFrom, colTo);
        const colEnd = Math.max(colFrom, colTo);

        for (let row = rowStart; row <= rowEnd; row++) {
            for (let col = colStart; col <= colEnd; col++) {
                next.add(toCellKey(row, keys[col]));
            }
        }
        return next;
    }, [keys, toCellKey]);

    const applyRectSelection = useCallback((target: TableCellPoint, useShift: boolean) => {
        if (useShift && anchorCell) {
            setSelectedCells(buildRectSelection(anchorCell, target));
            return;
        }
        setAnchorCell(target);
        setSelectedCells(new Set([toCellKey(target.rowIndex, target.colKey)]));
    }, [anchorCell, buildRectSelection, toCellKey]);

    const clearSelectedCells = useCallback(() => {
        if (selectedCells.size === 0) return;
        const cells: TableCellPoint[] = [];
        selectedCells.forEach((key) => {
            const [rowPart, colKey] = key.split('::');
            const rowIndex = Number(rowPart);
            if (!Number.isNaN(rowIndex) && colKey) {
                cells.push({ rowIndex, colKey });
            }
        });
        if (cells.length === 0) return;
        handleTableBulkClear(fieldKey, cells);
    }, [fieldKey, handleTableBulkClear, selectedCells]);

    const buildSelectedCellsTsv = useCallback((): string | null => {
        if (selectedCells.size <= 1) return null;

        let minRow = Number.POSITIVE_INFINITY;
        let maxRow = Number.NEGATIVE_INFINITY;
        let minCol = Number.POSITIVE_INFINITY;
        let maxCol = Number.NEGATIVE_INFINITY;

        selectedCells.forEach((cellKey) => {
            const [rowPart, colKey] = cellKey.split('::');
            const rowIndex = Number(rowPart);
            const colIndex = keys.indexOf(colKey);
            if (Number.isNaN(rowIndex) || colIndex < 0) return;

            minRow = Math.min(minRow, rowIndex);
            maxRow = Math.max(maxRow, rowIndex);
            minCol = Math.min(minCol, colIndex);
            maxCol = Math.max(maxCol, colIndex);
        });

        if (!Number.isFinite(minRow) || !Number.isFinite(minCol)) return null;

        const rows: string[] = [];
        for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex++) {
            const rowValue = Array.isArray(displayValue) ? displayValue[rowIndex] : undefined;
            const normalizedRow = rowValue && typeof rowValue === 'object' ? rowValue as Record<string, unknown> : null;

            const cols: string[] = [];
            for (let colIndex = minCol; colIndex <= maxCol; colIndex++) {
                const colKey = keys[colIndex];
                if (!colKey) {
                    cols.push('');
                    continue;
                }

                if (!selectedCells.has(toCellKey(rowIndex, colKey))) {
                    cols.push('');
                    continue;
                }

                const cellValue = normalizedRow ? normalizedRow[colKey] : '';
                cols.push(formatNestedValue(cellValue));
            }

            rows.push(cols.join('\t'));
        }

        return rows.join('\n');
    }, [displayValue, keys, selectedCells, toCellKey]);

    const handleTableCopy = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const tsv = buildSelectedCellsTsv();
        if (!tsv) return;

        event.preventDefault();
        event.clipboardData.setData('text/plain', tsv);
    }, [buildSelectedCellsTsv]);

    const getModalSize = useCallback(() => {
        if (typeof window === 'undefined') {
            return { width: 1400, height: 900 };
        }

        const width = Math.min(window.innerWidth * 0.96, 1400);
        const height = Math.min(window.innerHeight * 0.88, 900);
        return { width, height };
    }, []);

    const clampModalPosition = useCallback((left: number, top: number): ModalPosition => {
        if (typeof window === 'undefined') {
            return { left, top };
        }

        const { width, height } = getModalSize();
        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);

        return {
            left: Math.min(Math.max(0, left), maxLeft),
            top: Math.min(Math.max(0, top), maxTop),
        };
    }, [getModalSize]);

    const getCenteredModalPosition = useCallback((): ModalPosition => {
        if (typeof window === 'undefined') return { left: 0, top: 0 };

        const { width, height } = getModalSize();
        return {
            left: Math.max(0, (window.innerWidth - width) / 2),
            top: Math.max(0, (window.innerHeight - height) / 2),
        };
    }, [getModalSize]);

    const startModalDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!isFullscreen || event.button !== 0) return;

        const target = event.target as HTMLElement;
        if (target.closest('button, input, textarea, select, a')) return;

        const currentPosition = modalPosition || getCenteredModalPosition();
        modalDragRef.current = {
            active: true,
            pointerOffsetX: event.clientX - currentPosition.left,
            pointerOffsetY: event.clientY - currentPosition.top,
        };
        event.preventDefault();
    }, [getCenteredModalPosition, isFullscreen, modalPosition]);

    const handleFullscreenToggle = useCallback(() => {
        if (isFullscreen) {
            setIsFullscreen(false);
            return;
        }

        setModalPosition(getCenteredModalPosition());
        setIsFullscreen(true);
    }, [getCenteredModalPosition, isFullscreen]);

    useEffect(() => {
        if (!tableRef.current) return;
        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                setInnerTableWidth(entries[0].contentRect.width);
            }
        });
        observer.observe(tableRef.current);
        return () => observer.disconnect();
    }, [isCollapsed, displayValue?.length, keys.length]);

    useEffect(() => {
        const stopDragSelection = () => {
            isDragSelectingRef.current = false;
        };
        window.addEventListener('mouseup', stopDragSelection);
        return () => window.removeEventListener('mouseup', stopDragSelection);
    }, []);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!modalDragRef.current.active) return;

            const nextLeft = event.clientX - modalDragRef.current.pointerOffsetX;
            const nextTop = event.clientY - modalDragRef.current.pointerOffsetY;
            setModalPosition(clampModalPosition(nextLeft, nextTop));
        };

        const stopModalDrag = () => {
            modalDragRef.current.active = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', stopModalDrag);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', stopModalDrag);
        };
    }, [clampModalPosition]);

    useEffect(() => {
        if (!isFullscreen) return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsFullscreen(false);
            }
        };

        const handleResize = () => {
            setModalPosition((prev) => {
                if (!prev) return getCenteredModalPosition();
                return clampModalPosition(prev.left, prev.top);
            });
        };

        window.addEventListener('keydown', handleEsc);
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('keydown', handleEsc);
            window.removeEventListener('resize', handleResize);
            document.body.style.overflow = originalOverflow;
        };
    }, [clampModalPosition, getCenteredModalPosition, isFullscreen]);

    if (!hasSubFields) {
        return (
            <div className="mt-1 border rounded-md overflow-hidden bg-background shadow-sm">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-1 rounded">
                            <TableProperties className="w-3 h-3 text-primary" />
                        </div>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
                            컬럼 스키마 없음
                        </span>
                    </div>
                </div>
                <div className="p-3 text-center text-[10px] text-muted-foreground italic">
                    이 테이블은 `sub_fields`가 정의된 경우에만 컬럼을 표시합니다.
                </div>
            </div>
        );
    }

    if (!Array.isArray(displayValue) || displayValue.length === 0) {
        return (
            <div className="mt-1 border rounded-md overflow-hidden bg-background shadow-sm">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-1 rounded">
                            <TableProperties className="w-3 h-3 text-primary" />
                        </div>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
                            <span className="text-primary">0</span> 행, <span className="text-primary">0</span> 열
                        </span>
                    </div>
                </div>
                <div className="p-3 text-center text-[10px] text-muted-foreground italic">데이터 없음</div>
                <div className="p-1 px-2 border-t bg-muted/5">
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] font-bold text-primary hover:bg-primary/5 w-full justify-start gap-1" onClick={() => handleRowAdd(fieldKey)}>
                        <Plus className="w-3.5 h-3.5" /> 행 추가
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <>
            {isFullscreen && (
                <div
                    className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[1px]"
                    onClick={() => setIsFullscreen(false)}
                />
            )}
            <div
                className={cn(
                    "mt-1 border rounded-md overflow-hidden bg-background shadow-sm relative flex flex-col",
                    isFullscreen && "fixed z-[80] mt-0 h-[min(88vh,900px)] w-[min(96vw,1400px)] rounded-xl shadow-2xl"
                )}
                style={isFullscreen ? {
                    left: modalPosition?.left ?? 0,
                    top: modalPosition?.top ?? 0,
                } : undefined}
                onPaste={(e) => handleTablePaste(fieldKey, e)}
                onCopy={handleTableCopy}
            >
            <div
                className={cn(
                    "flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b hover:bg-muted/30 transition-colors shrink-0",
                    isFullscreen ? "cursor-move" : "cursor-pointer"
                )}
                onClick={() => {
                    if (!isFullscreen) toggleFieldCollapse(fieldKey);
                }}
                onMouseDown={startModalDrag}
            >
                <div className="flex items-center gap-2">
                    <TableProperties className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">
                        <span className="text-primary">{displayValue.length}</span> 행, <span className="text-primary">{keys.length}</span> 열
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleFullscreenToggle();
                        }}
                    >
                        {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); toggleFieldCollapse(fieldKey); }}>
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                </div>
            </div>

            {!isCollapsed && (
                <>
                    <div 
                        ref={tableScrollRef}
                        className={cn(
                            "overflow-auto max-w-full scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
                            isFullscreen ? "max-h-[calc(88vh-150px)]" : "max-h-[60vh]"
                        )}
                        onScroll={(e) => {
                            if (topScrollRef.current && topScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                                topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                            }
                        }}
                    >
                        <Table ref={tableRef} containerClassName="overflow-x-visible overflow-y-visible" className="text-[10px] table-auto min-w-full w-max border-separate border-spacing-0">
                            <TableHeader className="bg-muted/90 sticky top-0 z-40 backdrop-blur-sm shadow-sm">
                                <TableRow className="hover:bg-transparent h-7 group/header">
                                    <TableHead
                                        className={cn(
                                            "w-16 border-r border-b p-0",
                                            getStickyTableClasses({
                                                section: 'header',
                                                column: 'actions',
                                                isSelected: false,
                                            }).cellClassName
                                        )}
                                    ></TableHead>
                                    {keys.map((k: string, colIndex: number) => (
                                        <TableHead 
                                            key={k} 
                                            className={cn(
                                                "px-2 py-0 text-[11px] font-bold uppercase tracking-tighter h-7 border-r border-b relative group min-w-37.5 bg-muted",
                                                colIndex === 0 && getStickyTableClasses({
                                                    section: 'header',
                                                    column: 'first-data',
                                                    isSelected: false,
                                                }).cellClassName
                                            )} 
                                            style={{ width: colWidths[colIndex] ? `${colWidths[colIndex]}px` : 'auto' }}
                                        >
                                            <div className="truncate pr-1">{k}</div>
                                            <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-border opacity-0 group-hover:opacity-100 transition-opacity" onMouseDown={(e) => startColResize(e, fieldKey, colIndex)} />
                                        </TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {displayValue.map((row: any, rowIndex: number) => {
                                    const rowConfidence = getRowConfidence(row);
                                    const rowHighlight = buildRowHighlight(fieldKey, row, rowIndex);
                                    return (
                                    <TableRow
                                        key={rowIndex}
                                        className={cn(
                                            "h-8 hover:bg-primary/5 border-b last:border-0 transition-colors group/row",
                                            rowHighlight && "cursor-pointer"
                                        )}
                                        onClick={(e) => {
                                            if (!rowHighlight) return;
                                            e.stopPropagation();
                                            handleRowHighlight(fieldKey, row, rowIndex);
                                        }}
                                    >
                                        <TableCell
                                            className={cn(
                                                "p-0 border-r border-b text-center w-16",
                                                getStickyTableClasses({
                                                    section: 'body',
                                                    column: 'actions',
                                                    isSelected: false,
                                                }).cellClassName
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "h-8 px-0.5 flex items-center justify-center gap-0.5",
                                                    getStickyTableClasses({
                                                        section: 'body',
                                                        column: 'actions',
                                                        isSelected: false,
                                                    }).innerClassName
                                                )}
                                            >
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); handleRowDelete(fieldKey, rowIndex); }}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                                {rowConfidence !== null && (
                                                    <span
                                                        className={cn(
                                                            "inline-flex h-5 min-w-7 items-center justify-center rounded border px-1 text-[9px] font-semibold leading-none",
                                                            getRowConfidenceClass(rowConfidence)
                                                        )}
                                                        title={`행 신뢰도 ${Math.round(rowConfidence * 100)}%`}
                                                    >
                                                        {Math.round(rowConfidence * 100)}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        {keys.map((colKey: string, colIdx: number) => {
                                            const isSelected = isCellSelected(rowIndex, colKey);
                                            const stickyClasses = colIdx === 0
                                                ? getStickyTableClasses({
                                                    section: 'body',
                                                    column: 'first-data',
                                                    isSelected,
                                                })
                                                : null;

                                            return (
                                                <TableCell 
                                                    key={colKey} 
                                                    className={cn(
                                                        "p-0.5 border-r border-b last:border-r-0 overflow-hidden",
                                                        colIdx === 0
                                                            ? stickyClasses?.cellClassName
                                                            : "bg-background group-hover/row:bg-primary/5",
                                                        colIdx !== 0 && isSelected && "bg-primary/15 ring-1 ring-inset ring-primary/50"
                                                    )}
                                                >
                                                    <div className={cn("h-full w-full", stickyClasses?.innerClassName)}>
                                                        <input
                                                            className={cn(
                                                                "w-full h-6 px-1.5 bg-transparent border-none outline-none text-[10px]",
                                                                isSelected && "bg-primary/5"
                                                            )}
                                                            value={formatNestedValue(row[colKey])}
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                isDragSelectingRef.current = true;
                                                                applyRectSelection({ rowIndex, colKey }, e.shiftKey);
                                                            }}
                                                            onMouseEnter={() => {
                                                                if (!isDragSelectingRef.current || !anchorCell) return;
                                                                setSelectedCells(buildRectSelection(anchorCell, { rowIndex, colKey }));
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                applyRectSelection({ rowIndex, colKey }, e.shiftKey);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                // 단일 셀 편집 중 Backspace/Delete는 기본 입력 동작(한 글자 삭제)을 유지하고,
                                                                // 다중 셀 선택 상태에서만 일괄 비우기를 수행한다.
                                                                if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCells.size > 1) {
                                                                    e.preventDefault();
                                                                    clearSelectedCells();
                                                                }
                                                            }}
                                                            onChange={(e) => handleTableChange(fieldKey, rowIndex, colKey, e.target.value)}
                                                            onPaste={(e) => {
                                                                e.stopPropagation();
                                                                handleTablePaste(fieldKey, e, rowIndex, colKey);
                                                            }}
                                                        />
                                                    </div>
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* ALWAYS VISIBLE MIRROR SCROLLBAR FIXED AT BOTTOM */}
                    <div 
                        ref={topScrollRef}
                        className="sticky bottom-0 z-50 w-full overflow-x-auto overflow-y-hidden bg-background/90 backdrop-blur-md border-t shadow-[0_-4px_10px_rgba(0,0,0,0.05)] [&::-webkit-scrollbar]:h-4 [&::-webkit-scrollbar-track]:bg-primary/10 [&::-webkit-scrollbar-thumb]:bg-primary/40 [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-primary/60"
                        onScroll={(e) => {
                            if (tableScrollRef.current && tableScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                                tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                            }
                        }}
                    >
                        <div style={{ width: innerTableWidth, height: '1px' }} />
                    </div>

                    <div className="p-1 px-2 border-t bg-muted/5 shrink-0 relative z-10">
                        <Button variant="ghost" size="sm" className="h-7 text-[10px] font-bold text-primary hover:bg-primary/5 w-full justify-start gap-1" onClick={() => handleRowAdd(fieldKey)}>
                            <Plus className="w-3.5 h-3.5" /> 행 추가
                        </Button>
                    </div>
                </>
            )}
            </div>
        </>
    );
});
EditableTable.displayName = 'EditableTable';

const MemoizedFieldItem = memo(({
    fieldKey,
    value,
    confidence,
    isSelected,
    onFieldSelect,
    model,
    handleValueChange,
    handleObjectChange,
    handleTableChange,
    handleRowDelete,
    handleRowAdd,
    handleTablePaste,
    handleTableBulkClear,
    handleRowHighlight,
    isCollapsed,
    toggleFieldCollapse,
    colWidths,
    startColResize
}: any) => {
    const displayValue = getDisplayValue(value);
    const fieldDef = findFieldDefByKey(model, fieldKey);
    const isTableSchema = fieldDef?.type === 'table';

    const renderContent = () => {
        const isTableType =
            isTableSchema ||
            value?.type === 'table' ||
            (Array.isArray(displayValue) && displayValue.length > 0 && typeof displayValue[0] === 'object' && displayValue[0] !== null);

        if ((value === null || value === undefined) && !isTableType) {
            return <Input className="h-8 text-sm" placeholder="값 입력..." onChange={(e) => handleValueChange(fieldKey, e.target.value)} />;
        }

        if (isTableType) {
            return (
                <EditableTable
                    fieldKey={fieldKey}
                    fieldValue={value}
                    displayValue={displayValue}
                    model={model}
                    colWidths={colWidths}
                    isCollapsed={isCollapsed}
                    toggleFieldCollapse={toggleFieldCollapse}
                    startColResize={startColResize}
                    handleRowAdd={handleRowAdd}
                    handleRowDelete={handleRowDelete}
                    handleTableChange={handleTableChange}
                    handleTablePaste={handleTablePaste}
                    handleTableBulkClear={handleTableBulkClear}
                    handleRowHighlight={handleRowHighlight}
                />
            );
        }

        if (Array.isArray(displayValue)) {
            return (
                <div className="space-y-1 mt-1">
                    {displayValue.map((v, i) => (
                        <Input key={i} className="h-7 text-[11px]" value={formatNestedValue(v)} onChange={(e) => {
                            const newArr = [...displayValue];
                            newArr[i] = wrapValue(newArr[i], e.target.value);
                            handleValueChange(fieldKey, newArr);
                        }} />
                    ))}
                    {displayValue.length === 0 && <span className="text-[10px] text-muted-foreground italic pl-1">데이터 없음</span>}
                </div>
            );
        }

        if (typeof displayValue === 'object' && displayValue !== null) {
            const entries = Object.entries(displayValue).filter(([k]) => !METADATA_KEYS.includes(k));
            if (entries.length === 0) return <span className="text-[10px] text-muted-foreground italic pl-1">상세 데이터 없음</span>;
            return (
                <div className="grid grid-cols-1 gap-2 mt-1 p-2 bg-muted/20 border rounded-md">
                    {entries.map(([subK, subV]) => (
                        <div key={subK} className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-muted-foreground w-20 truncate uppercase">{subK}</span>
                            <Input className="h-7 text-[10px] flex-1" value={formatNestedValue(subV)} onChange={(e) => handleObjectChange(fieldKey, subK, e.target.value)} />
                        </div>
                    ))}
                </div>
            );
        }

        if (typeof displayValue === 'string' && displayValue.length > 60) {
            return <Textarea className="text-[11px] min-h-20 mt-1 resize-y" value={displayValue} onChange={(e) => handleValueChange(fieldKey, e.target.value)} />;
        }

        return <Input className="h-8 text-sm mt-0.5" value={formatNestedValue(value)} onChange={(e) => handleValueChange(fieldKey, e.target.value)} />;
    };

    return (
        <div
            className={cn(
                "space-y-1.5 p-2 rounded-lg transition-colors border border-transparent shadow-sm",
                confidence !== null && confidence <= 0.7 ? "bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-900/30" : "hover:bg-muted/30 bg-background",
                isSelected && "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-md"
            )}
            onClick={() => onFieldSelect(fieldKey)}
        >
            <div className="flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-1.5 min-w-0">
                    {confidence !== null && confidence <= 0.7 && <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider truncate">{fieldKey}</label>
                </div>
                {confidence !== null && (
                    <Badge variant={confidence <= 0.7 ? "destructive" : "outline"} className={cn("text-[10px] py-0 h-4 font-bold ring-1 ring-inset", confidence > 0.7 && getConfidenceColor(confidence))}>
                        신뢰도 {(confidence * 100).toFixed(0)}%
                    </Badge>
                )}
            </div>
            {renderContent()}
        </div>
    );
});
MemoizedFieldItem.displayName = 'MemoizedFieldItem';

interface ExtractionReviewViewProps {
    previewData: PreviewData | null;
    result: Record<string, any> | null;
    model: ExtractionModel | null;
    highlights: Highlight[];
    selectedSubDocIndex: number;
    selectedFieldKey: string | null;
    file: File | null;
    fileUrl: string | null;
    filename?: string | null;
    isProcessing?: boolean;
    isSendingWebhook?: boolean;
    onSubDocSelect: (index: number) => void;
    onFieldSelect: (key: string | null) => void;
    onRetry: () => void;
    onSave: (guideData: Record<string, any>, otherData: any[]) => void;
    onSendWebhook?: () => void;
    onVersionSwitch?: (logId: string) => void;
    canEditModel?: (targetModelId?: string | null) => boolean;
    canSendWebhook?: boolean;
}

interface SourceFileMeta {
    filename: string;
    blob_path: string;
}

interface ViewerImageItem {
    filename: string;
    url: string;
}

export function ExtractionReviewView({
    previewData,
    result,
    model,
    highlights,
    selectedSubDocIndex,
    selectedFieldKey,
    file,
    fileUrl,
    filename,
    onSubDocSelect,
    onFieldSelect,
    onRetry,
    onSave,
    isProcessing = false,
    isSendingWebhook = false,
    onSendWebhook,
    onVersionSwitch,
    canEditModel = () => false,
    canSendWebhook
}: ExtractionReviewViewProps) {
    const [localData, setLocalData] = useState<Record<string, any>>({});
    const [isModified, setIsModified] = useState(false);
    const [rowHighlight, setRowHighlight] = useState<Highlight | null>(null);
    const [currentFileUrl, setCurrentFileUrl] = useState<string | null>(fileUrl);
    const [subModelCache, setSubModelCache] = useState<Record<string, ExtractionModel>>({});
    const [fallbackImages, setFallbackImages] = useState<ViewerImageItem[]>([]);
    const [fallbackImageIndex, setFallbackImageIndex] = useState(0);

    // 1. Resizable Panel State
    const [rightPanelWidth, setRightPanelWidth] = useState(480);
    const isResizingRef = useRef(false);

    // 2. Resizable Table Columns State
    const [colWidths, setColWidths] = useState<Record<string, Record<string, number>>>({});
    const tableResizingRef = useRef<{ key: string; colIndex: number; startX: number; startWidth: number } | null>(null);
    const pdfViewerRef = useRef<PDFViewerHandle>(null);
    const [collapsedFields, setCollapsedFields] = useState<Set<string>>(new Set());

    const toggleFieldCollapse = useCallback((key: string) => {
        setCollapsedFields(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const [activeViewerTab, setActiveViewerTab] = useState<string>(() =>
        getFileType(file, fileUrl, filename)
    );

    useEffect(() => {
        const subModelId = previewData?.sub_documents?.[selectedSubDocIndex]?.model_id;
        if (!subModelId) return;
        if (model?.id === subModelId) return;
        if (subModelCache[subModelId]) return;

        let cancelled = false;
        getExtractionModel(subModelId)
            .then((fetchedModel) => {
                if (cancelled || !fetchedModel) return;
                setSubModelCache((prev) => {
                    if (prev[subModelId]) return prev;
                    return { ...prev, [subModelId]: fetchedModel as ExtractionModel };
                });
            })
            .catch((error) => {
                console.warn(`[ExtractionReviewView] 하위 모델(${subModelId}) 스키마 로드 실패:`, error);
            });

        return () => {
            cancelled = true;
        };
    }, [previewData, selectedSubDocIndex, model?.id, subModelCache]);

    const resolveFieldDef = useCallback((fieldKey: string) => {
        const directFieldDef = findFieldDefByKey(model, fieldKey);
        if (directFieldDef) return directFieldDef;

        const subModelId = previewData?.sub_documents?.[selectedSubDocIndex]?.model_id;
        if (!subModelId) return undefined;

        const subModel = subModelCache[subModelId];
        if (!subModel) return undefined;

        return findFieldDefByKey(subModel, fieldKey);
    }, [model, previewData, selectedSubDocIndex, subModelCache]);

    const normalizeLegacyTableRows = useCallback((source: Record<string, any>): Record<string, any> => {
        const next: Record<string, any> = { ...source };
        let changed = false;

        Object.entries(source || {}).forEach(([fieldKey, fieldValue]) => {
            const displayValue = getDisplayValue(fieldValue);
            if (!Array.isArray(displayValue)) return;

            const filteredRows = displayValue.filter((row) => !isEmptyLegacyRow(row));
            if (filteredRows.length !== displayValue.length) {
                next[fieldKey] = wrapValue(fieldValue, filteredRows);
                changed = true;
            }
        });

        return changed ? next : source;
    }, []);

    const setGlobalCursor = (cursor: string) => {
        if (typeof document !== 'undefined') document.body.style.cursor = cursor;
    };

    const handlePanelResize = useCallback((e: MouseEvent) => {
        if (!isResizingRef.current) return;
        const newWidth = window.innerWidth - e.clientX - 24;
        if (newWidth > 200 && newWidth < 1000) setRightPanelWidth(newWidth);
    }, []);

    const stopPanelResize = useCallback(function onMouseUp() {
        isResizingRef.current = false;
        setGlobalCursor('default');
        window.removeEventListener('mousemove', handlePanelResize);
        window.removeEventListener('mouseup', onMouseUp);
    }, [handlePanelResize]);

    const startPanelResize = () => {
        isResizingRef.current = true;
        setGlobalCursor('col-resize');
        window.addEventListener('mousemove', handlePanelResize);
        window.addEventListener('mouseup', stopPanelResize);
    };

    const handleColResize = useCallback((e: MouseEvent) => {
        if (!tableResizingRef.current) return;
        const { key, colIndex, startX, startWidth } = tableResizingRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);

        setColWidths(prev => ({
            ...prev,
            [key]: { ...(prev[key] || {}), [colIndex]: newWidth }
        }));
    }, []);

    const stopColResize = useCallback(function onMouseUp() {
        tableResizingRef.current = null;
        setGlobalCursor('default');
        window.removeEventListener('mousemove', handleColResize);
        window.removeEventListener('mouseup', onMouseUp);
    }, [handleColResize]);

    const startColResize = useCallback((e: React.MouseEvent, key: string, colIndex: number) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = (e.currentTarget.parentElement?.getBoundingClientRect().width || 100);
        tableResizingRef.current = { key, colIndex, startX, startWidth };
        setGlobalCursor('col-resize');
        window.addEventListener('mousemove', handleColResize);
        window.addEventListener('mouseup', stopColResize);
    }, [handleColResize, stopColResize]);

    useEffect(() => {
        setRowHighlight(null);
        const currentSubDoc = previewData?.sub_documents?.[selectedSubDocIndex];
        const currentData = currentSubDoc
            ? currentSubDoc?.data?.guide_extracted
            : previewData?.guide_extracted || result || {};

        setLocalData(normalizeLegacyTableRows(removeSystemResultKeys(currentData || {})));
        setIsModified(false);

        const updateUrl = async () => {
            const blobPath = currentSubDoc?.file?.blob_path;
            let targetUrl = fileUrl;
            if (blobPath) {
                if (blobPath.startsWith('http')) targetUrl = blobPath;
                else {
                    try { targetUrl = await getFileSasUrl(blobPath); }
                    catch (err) { console.error('Failed to get SAS URL:', err); targetUrl = null; }
                }
            }
            if (targetUrl !== currentFileUrl) {
                setCurrentFileUrl(targetUrl);
                const newFileType = getFileType(
                    file,
                    targetUrl,
                    currentSubDoc?.file?.filename || filename
                );
                setActiveViewerTab(newFileType);
            }
        };
        updateUrl();
    }, [
        previewData,
        result,
        selectedSubDocIndex,
        fileUrl,
        currentFileUrl,
        normalizeLegacyTableRows,
        file,
        filename
    ]);

    useEffect(() => {
        const hasSubDocuments = Array.isArray(previewData?.sub_documents) && previewData.sub_documents.length > 0;
        if (hasSubDocuments) {
            setFallbackImages([]);
            setFallbackImageIndex(0);
            return;
        }

        const sourceFilesRaw = (previewData as { beta_metadata?: { source_files?: unknown } } | null)?.beta_metadata?.source_files;
        const sourceFiles: SourceFileMeta[] = Array.isArray(sourceFilesRaw)
            ? sourceFilesRaw.flatMap((item): SourceFileMeta[] => {
                if (!item || typeof item !== 'object') return [];
                const maybeFile = item as Partial<SourceFileMeta>;
                const filename = typeof maybeFile.filename === 'string' ? maybeFile.filename.trim() : '';
                const blobPath = typeof maybeFile.blob_path === 'string' ? maybeFile.blob_path.trim() : '';
                if (!filename || !blobPath) return [];
                return [{ filename, blob_path: blobPath }];
            })
            : [];

        if (sourceFiles.length === 0) {
            setFallbackImages([]);
            setFallbackImageIndex(0);
            return;
        }

        let cancelled = false;

        (async () => {
            const resolvedItems = await Promise.all(sourceFiles.map(async (sourceFile): Promise<ViewerImageItem | null> => {
                try {
                    if (sourceFile.blob_path.startsWith('http')) {
                        return {
                            filename: sourceFile.filename,
                            url: sourceFile.blob_path,
                        };
                    }

                    const sasUrl = await getFileSasUrl(sourceFile.blob_path);
                    if (!sasUrl) return null;
                    return {
                        filename: sourceFile.filename,
                        url: sasUrl,
                    };
                } catch {
                    return null;
                }
            }));

            if (cancelled) return;

            const validItems = resolvedItems.filter((item): item is ViewerImageItem => !!item);
            setFallbackImages(validItems);
            setFallbackImageIndex((prev) => {
                if (validItems.length === 0) return 0;
                return Math.min(prev, validItems.length - 1);
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [previewData]);

    const handleValueChange = useCallback((key: string, value: any) => {
        setLocalData(prev => {
            const oldValue = prev[key];
            const newValue = wrapValue(oldValue, value);
            return { ...prev, [key]: newValue };
        });
        setIsModified(true);
    }, []);

    const handleObjectChange = useCallback((parentKey: string, subKey: string, value: any) => {
        setLocalData(prev => {
            const currentObj = getDisplayValue(prev[parentKey]) || {};
            const oldValue = currentObj[subKey];
            const newValue = wrapValue(oldValue, value);
            const updatedObj = { ...currentObj, [subKey]: newValue };
            return { ...prev, [parentKey]: wrapValue(prev[parentKey], updatedObj) };
        });
        setIsModified(true);
    }, []);

    const handleTableChange = useCallback((parentKey: string, rowIndex: number, colKey: string, value: any) => {
        setLocalData(prev => {
            const parentVal = prev[parentKey];
            const displayValue = getDisplayValue(parentVal);
            const currentArray = [...(Array.isArray(displayValue) ? displayValue : [])];
            if (currentArray[rowIndex]) {
                const oldValue = currentArray[rowIndex][colKey];
                const newValue = wrapValue(oldValue, value);
                currentArray[rowIndex] = { ...currentArray[rowIndex], [colKey]: newValue };
                return { ...prev, [parentKey]: wrapValue(parentVal, currentArray) };
            }
            return prev;
        });
        setIsModified(true);
    }, []);

    const handleRowDelete = useCallback((parentKey: string, rowIndex: number) => {
        setLocalData(prev => {
            const parentVal = prev[parentKey];
            const displayValue = getDisplayValue(parentVal);
            if (!Array.isArray(displayValue)) return prev;
            const newArray = displayValue.filter((_, i) => i !== rowIndex);
            return { ...prev, [parentKey]: wrapValue(parentVal, newArray) };
        });
        setIsModified(true);
    }, []);

    const handleTableBulkClear = useCallback((parentKey: string, cells: TableCellPoint[]) => {
        if (!Array.isArray(cells) || cells.length === 0) return;

        setLocalData(prev => {
            const parentVal = prev[parentKey];
            const displayValue = getDisplayValue(parentVal);
            if (!Array.isArray(displayValue)) return prev;

            const nextArray = [...displayValue];
            let changed = false;

            cells.forEach(({ rowIndex, colKey }) => {
                if (rowIndex < 0 || rowIndex >= nextArray.length) return;
                const row = nextArray[rowIndex];
                if (!row || typeof row !== 'object') return;

                const oldValue = row[colKey];
                const newValue = wrapValue(oldValue, '');
                if (newValue === oldValue) return;

                nextArray[rowIndex] = { ...row, [colKey]: newValue };
                changed = true;
            });

            if (!changed) return prev;
            return { ...prev, [parentKey]: wrapValue(parentVal, nextArray) };
        });

        setIsModified(true);
    }, []);

    const handleRowHighlight = useCallback((fieldKey: string, row: any, rowIndex: number) => {
        const highlight = buildRowHighlight(fieldKey, row, rowIndex);
        if (!highlight) return;
        setRowHighlight(highlight);
        onFieldSelect(fieldKey);
        window.setTimeout(() => {
            pdfViewerRef.current?.scrollToHighlight(fieldKey);
        }, 0);
    }, [onFieldSelect]);

    const handleRowAdd = useCallback((parentKey: string) => {
        setLocalData(prev => {
            const parentVal = prev[parentKey];
            const displayValue = getDisplayValue(parentVal);
            const currentArray = Array.isArray(displayValue) ? displayValue : [];
            const newRow: Record<string, any> = {};
            const fieldDef = resolveFieldDef(parentKey);
            const valueSubFields = Array.isArray((parentVal as any)?.sub_fields) ? (parentVal as any).sub_fields : [];
            const keys = resolveStrictTableColumnKeys(fieldDef?.sub_fields, valueSubFields);

            keys.forEach((key) => { newRow[key] = ""; });
            if (Object.keys(newRow).length === 0) return prev;
            return { ...prev, [parentKey]: wrapValue(parentVal, [...currentArray, newRow]) };
        });
        setIsModified(true);
    }, [resolveFieldDef]);

    const handleTablePaste = useCallback((fieldKey: string, event: React.ClipboardEvent, startRowIndex?: number, startColKey?: string) => {
        const text = event.clipboardData.getData('text/plain');
        if (!text.includes('\t') && !text.includes('\n')) return; // Single value paste, let default handle it

        event.preventDefault();
        const rows = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (rows.length === 0) return;

        // Parse clipboard into a 2D array of strings
        const clipboardGrid = rows.map(line => line.split('\t'));

        setLocalData(prev => {
            const parentVal = prev[fieldKey];
            const displayValue = getDisplayValue(parentVal);
            const fieldDef = resolveFieldDef(fieldKey);
            const valueSubFields = Array.isArray((parentVal as any)?.sub_fields) ? (parentVal as any).sub_fields : [];
            const keys = resolveStrictTableColumnKeys(fieldDef?.sub_fields, valueSubFields);

            if (keys.length === 0) return prev;

            const currentArray = Array.isArray(displayValue) ? [...displayValue] : [];
            const newArray = [...currentArray];

            const startRowIdx = startRowIndex !== undefined ? startRowIndex : currentArray.length;
            const startColIdx = startColKey ? keys.indexOf(startColKey) : 0;

            if (startColIdx === -1) return prev;

            clipboardGrid.forEach((rowCells, rOffset) => {
                const targetRowIdx = startRowIdx + rOffset;
                // Get existing row or create a new empty one with all keys
                const targetRow = { ...(newArray[targetRowIdx] || {}) };
                if (!newArray[targetRowIdx]) {
                    keys.forEach(k => { targetRow[k] = ""; });
                }

                rowCells.forEach((cellValue, cOffset) => {
                    const targetColIdx = startColIdx + cOffset;
                    if (targetColIdx < keys.length) {
                        const colKey = keys[targetColIdx];
                        const oldValue = targetRow[colKey];
                        targetRow[colKey] = wrapValue(oldValue, cellValue);
                    }
                });
                newArray[targetRowIdx] = targetRow;
            });

            return { ...prev, [fieldKey]: wrapValue(parentVal, newArray) };
        });
        setIsModified(true);
        toast.success(`${clipboardGrid.length}개의 데이터 행이 처리되었습니다.`);
    }, [localData, resolveFieldDef]);

    const handleFieldSelect = useCallback((key: string | null) => {
        setRowHighlight(null);
        onFieldSelect(key);
    }, [onFieldSelect]);

    const stripBbox = (data: any): any => {
        if (!data || typeof data !== 'object') return data;
        if (Array.isArray(data)) return data.map(stripBbox);
        const result: any = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === 'bbox') continue;
            result[key] = stripBbox(value);
        }
        return result;
    };

    const currentSubDoc = previewData?.sub_documents?.[selectedSubDocIndex];
    const hasSubDocuments = Array.isArray(previewData?.sub_documents) && previewData.sub_documents.length > 0;
    const canUseFallbackCarousel = !hasSubDocuments && fallbackImages.length > 0;
    const activeImageUrl = hasSubDocuments
        ? currentFileUrl
        : (fallbackImages[fallbackImageIndex]?.url || currentFileUrl);
    const activeImageName = hasSubDocuments
        ? (currentSubDoc?.file?.filename || filename)
        : (fallbackImages[fallbackImageIndex]?.filename || filename);
    const imageCount = hasSubDocuments
        ? (previewData?.sub_documents?.length || 0)
        : fallbackImages.length;
    const imageIndex = hasSubDocuments ? selectedSubDocIndex : fallbackImageIndex;
    const hasImageCarousel = imageCount > 1;
    const currentOcrText = currentSubDoc?.raw_content || previewData?.raw_content || '';
    const selectedSubDocHistory = Array.isArray((currentSubDoc as any)?.history)
        ? (currentSubDoc as any).history.find((h: any) => h?.id === (currentSubDoc as any)?.id)
        : null;
    const currentTaggedText =
        (currentSubDoc as any)?.beta_metadata?.parsed_content ||
        (currentSubDoc as any)?.debug_data?.beta_metadata?.parsed_content ||
        (selectedSubDocHistory as any)?.debug_data?.beta_metadata?.parsed_content ||
        (previewData as any)?.beta_metadata?.parsed_content ||
        (previewData as any)?.debug_data?.beta_metadata?.parsed_content ||
        '';
    const currentRawTables =
        (currentSubDoc as any)?.raw_tables ||
        (currentSubDoc as any)?.debug_data?.raw_tables ||
        (selectedSubDocHistory as any)?.debug_data?.raw_tables ||
        previewData?.raw_tables ||
        (previewData as any)?.debug_data?.raw_tables ||
        [];
    const currentTableBatchInputs =
        (currentSubDoc as any)?.debug_data?.table_batch_inputs ||
        (currentSubDoc as any)?.debug_data?._debug_info?.table_batch_inputs ||
        (selectedSubDocHistory as any)?.debug_data?.table_batch_inputs ||
        (selectedSubDocHistory as any)?.debug_data?._debug_info?.table_batch_inputs ||
        (previewData as any)?.debug_data?.table_batch_inputs ||
        (previewData as any)?.debug_data?._debug_info?.table_batch_inputs ||
        [];
    const currentLlmRequestBodiesRaw =
        (currentSubDoc as any)?.llm_request_bodies ||
        (currentSubDoc as any)?.debug_data?.llm_request_bodies ||
        (currentSubDoc as any)?.debug_data?._debug_info?.llm_request_bodies ||
        (selectedSubDocHistory as any)?.llm_request_bodies ||
        (selectedSubDocHistory as any)?.debug_data?.llm_request_bodies ||
        (selectedSubDocHistory as any)?.debug_data?._debug_info?.llm_request_bodies ||
        (previewData as any)?.llm_request_bodies ||
        (previewData as any)?.debug_data?.llm_request_bodies ||
        (previewData as any)?.debug_data?._debug_info?.llm_request_bodies ||
        [];
    const currentLlmRequestBodies = Array.isArray(currentLlmRequestBodiesRaw)
        ? currentLlmRequestBodiesRaw
        : (currentLlmRequestBodiesRaw ? [currentLlmRequestBodiesRaw] : []);
    const currentLlmResponseBodiesRaw =
        (currentSubDoc as any)?.llm_response_bodies ||
        (currentSubDoc as any)?.debug_data?.llm_response_bodies ||
        (currentSubDoc as any)?.debug_data?._debug_info?.llm_response_bodies ||
        (selectedSubDocHistory as any)?.llm_response_bodies ||
        (selectedSubDocHistory as any)?.debug_data?.llm_response_bodies ||
        (selectedSubDocHistory as any)?.debug_data?._debug_info?.llm_response_bodies ||
        (previewData as any)?.llm_response_bodies ||
        (previewData as any)?.debug_data?.llm_response_bodies ||
        (previewData as any)?.debug_data?._debug_info?.llm_response_bodies ||
        [];
    const currentLlmResponseBodies = Array.isArray(currentLlmResponseBodiesRaw)
        ? currentLlmResponseBodiesRaw
        : (currentLlmResponseBodiesRaw ? [currentLlmResponseBodiesRaw] : []);
    const hasTableBatchDebugText = typeof currentTaggedText === 'string' && currentTaggedText.includes('[TABLE_BATCH_INPUTS]');
    const currentSubDocModelId = currentSubDoc?.model_id;
    const currentSubDocModel = currentSubDocModelId
        ? (currentSubDocModelId === model?.id ? model : subModelCache[currentSubDocModelId])
        : model;
    const configuredOcrEngineRaw = currentSubDocModel?.beta_features?.ocr_engine;
    const extractedPathRaw =
        (selectedSubDocHistory as any)?.debug_data?.extraction_path ||
        (selectedSubDocHistory as any)?.debug_data?._debug_info?.extraction_path ||
        (currentSubDoc as any)?.debug_data?.extraction_path ||
        (currentSubDoc as any)?.debug_data?._debug_info?.extraction_path ||
        (previewData as any)?.debug_data?.extraction_path ||
        (previewData as any)?.debug_data?._debug_info?.extraction_path;
    const normalizedOcrEngine = (
        typeof configuredOcrEngineRaw === 'string' && configuredOcrEngineRaw.trim()
            ? configuredOcrEngineRaw
            : (typeof extractedPathRaw === 'string' ? extractedPathRaw : 'di')
    ).toLowerCase();
    const shouldShowTaggedText = hasTableBatchDebugText || !(normalizedOcrEngine === 'cu' || normalizedOcrEngine === 'content_understanding');
    const currentFileName = activeImageName;
    const llmRequestBodyText = Array.isArray(currentLlmRequestBodies) && currentLlmRequestBodies.length > 0
        ? stripCoordinateBracketsForViewer(JSON.stringify(currentLlmRequestBodies, null, 2))
        : '';
    const clampedLlmRequestBody = clampViewerText(llmRequestBodyText);
    const llmResponseBodyText = Array.isArray(currentLlmResponseBodies) && currentLlmResponseBodies.length > 0
        ? JSON.stringify(currentLlmResponseBodies, null, 2)
        : '';
    const clampedLlmResponseBody = clampViewerText(llmResponseBodyText);
    const effectiveModelId = currentSubDoc?.model_id || model?.id;
    const canEditEffectiveModel = canEditModel(effectiveModelId);
    const isSubModel = !!currentSubDoc?.model_id && currentSubDoc.model_id !== model?.id;
    const hasWebhookUrl = typeof canSendWebhook === 'boolean'
        ? canSendWebhook
        : (isSubModel
            ? !!(model?.webhook_url && model.webhook_url.trim())
            : !!(model?.webhook_url && model.webhook_url.trim()));
    const ocrText = currentOcrText;
    const fileType = getFileType(file, activeImageUrl, currentFileName);
    const viewerHighlights = rowHighlight ? [rowHighlight] : highlights;

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="flex-1 flex gap-4 p-6 overflow-hidden">
                {/* Left Panel - Viewer with Tabs */}
                <div className="flex-1 bg-muted rounded-lg overflow-hidden flex flex-col">
                    <Tabs value={activeViewerTab} onValueChange={setActiveViewerTab} className="h-full flex flex-col relative">
                        <TabsList className="w-full justify-start rounded-none border-b bg-background overflow-x-auto shrink-0">
                            {fileType === 'pdf' && <TabsTrigger value="pdf">PDF 뷰어</TabsTrigger>}
                            {fileType === 'excel' && <TabsTrigger value="excel">스프레드시트</TabsTrigger>}
                            {fileType === 'image' && <TabsTrigger value="image">이미지 원본</TabsTrigger>}
                            <TabsTrigger value="ocr">OCR 텍스트</TabsTrigger>
                            <TabsTrigger value="llm-request">LLM 요청 바디</TabsTrigger>
                            <TabsTrigger value="llm-response">LLM 응답 바디</TabsTrigger>
                        </TabsList>

                        <div className="flex-1 relative overflow-hidden bg-muted/20">
                            {fileType === 'pdf' && (
                                <TabsContent value="pdf" className="h-full m-0 data-[state=inactive]:hidden">
                                    {activeImageUrl ? (
                                        <PDFViewer
                                            key={activeImageUrl}
                                            ref={pdfViewerRef}
                                            fileUrl={activeImageUrl}
                                            highlights={viewerHighlights}
                                            activeFieldKey={selectedFieldKey}
                                            ocrEngine={normalizedOcrEngine}
                                            onHighlightClick={handleFieldSelect}
                                        />
                                    ) : (
                                        <div className="h-full flex items-center justify-center">
                                            <div className="text-center text-muted-foreground">
                                                <p className="text-lg font-medium mb-2">PDF 뷰어</p>
                                                <p className="text-sm">파일: {currentFileName || '알 수 없음'}</p>
                                                <p className="text-sm text-muted-foreground mt-2">파일 URL을 불러오는 중...</p>
                                            </div>
                                        </div>
                                    )}
                                </TabsContent>
                            )}

                            {fileType === 'excel' && (
                                <TabsContent value="excel" className="h-full m-0 data-[state=inactive]:hidden">
                                    {activeImageUrl && (
                                        <ExcelGridViewer
                                            ref={pdfViewerRef as any}
                                            fileUrl={activeImageUrl}
                                        />
                                    )}
                                </TabsContent>
                            )}

                            {fileType === 'image' && (
                                <TabsContent value="image" className="h-full m-0 data-[state=inactive]:hidden flex flex-col">
                                    {activeImageUrl ? (
                                        <TransformWrapper
                                            key={activeImageUrl}
                                            initialScale={1}
                                            minScale={0.5}
                                            maxScale={5}
                                            centerOnInit={true}
                                        >
                                            {({ zoomIn, zoomOut, resetTransform }) => (
                                                <div className="w-full h-full flex flex-col relative overflow-hidden">
                                                    {hasImageCarousel && (
                                                        <div className="absolute top-2 left-2 z-10 bg-background/85 backdrop-blur-sm border rounded-md shadow-sm flex items-center gap-1 p-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                disabled={imageIndex <= 0}
                                                                onClick={() => {
                                                                    if (hasSubDocuments) {
                                                                        onSubDocSelect(Math.max(0, selectedSubDocIndex - 1));
                                                                        return;
                                                                    }
                                                                    if (canUseFallbackCarousel) {
                                                                        setFallbackImageIndex((prev) => Math.max(0, prev - 1));
                                                                    }
                                                                }}
                                                            >
                                                                <ChevronLeft className="w-4 h-4" />
                                                            </Button>
                                                            <span className="px-1 text-xs font-semibold text-foreground/80 tabular-nums">
                                                                {imageCount === 0 ? 0 : imageIndex + 1}/{imageCount}
                                                            </span>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                disabled={imageIndex >= imageCount - 1}
                                                                onClick={() => {
                                                                    if (hasSubDocuments) {
                                                                        onSubDocSelect(Math.min(imageCount - 1, selectedSubDocIndex + 1));
                                                                        return;
                                                                    }
                                                                    if (canUseFallbackCarousel) {
                                                                        setFallbackImageIndex((prev) => Math.min(imageCount - 1, prev + 1));
                                                                    }
                                                                }}
                                                            >
                                                                <ChevronRight className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                    <div className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur-sm border rounded-md shadow-sm flex items-center gap-1 p-1">
                                                        <Button variant="ghost" size="icon" onClick={() => zoomOut()} className="h-7 w-7"><ZoomOut className="w-4 h-4" /></Button>
                                                        <Button variant="ghost" size="icon" onClick={() => zoomIn()} className="h-7 w-7"><ZoomIn className="w-4 h-4" /></Button>
                                                        <Button variant="ghost" size="icon" onClick={() => resetTransform()} className="h-7 w-7"><RotateCcw className="w-4 h-4" /></Button>
                                                    </div>
                                                    <div className="flex-1 overflow-hidden pointer-events-auto">
                                                        <TransformComponent
                                                            wrapperStyle={{ width: '100%', height: '100%' }}
                                                            contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                        >
                                                            <img
                                                                src={activeImageUrl}
                                                                className="max-w-full max-h-full object-contain shadow-md"
                                                                alt="doc"
                                                                draggable={false}
                                                            />
                                                        </TransformComponent>
                                                    </div>
                                                </div>
                                            )}
                                        </TransformWrapper>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">이미지를 불러올 수 없습니다.</div>
                                    )}
                                </TabsContent>
                            )}

                            <TabsContent value="ocr" className="h-full m-0 p-4 overflow-auto data-[state=inactive]:hidden bg-background">
                                <OcrTextViewer
                                    ocrText={ocrText}
                                    llmTaggedText={currentTaggedText}
                                    showTaggedText={shouldShowTaggedText}
                                    rawTables={currentRawTables}
                                    tableBatchInputs={currentTableBatchInputs}
                                />
                            </TabsContent>

                            <TabsContent value="llm-request" className="h-full m-0 p-4 overflow-auto data-[state=inactive]:hidden bg-background">
                                <div className="h-full rounded-md border bg-background overflow-hidden flex flex-col">
                                    {clampedLlmRequestBody.truncated && (
                                        <div className="bg-yellow-500/10 text-yellow-600 text-xs p-2 text-center shrink-0 border-b border-yellow-500/20">
                                            요청 바디가 너무 길어 처음 {MAX_LLM_REQUEST_VIEWER_CHARS.toLocaleString()}자까지만 표시됩니다.
                                        </div>
                                    )}
                                    <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground">CU/DI 처리 후 LLM 전달 Request Body</div>
                                    {clampedLlmRequestBody.text ? (
                                        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 p-4 flex-1 overflow-auto">
                                            {clampedLlmRequestBody.text}
                                        </pre>
                                    ) : (
                                        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                                            저장된 LLM 요청 바디가 없습니다.
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="llm-response" className="h-full m-0 p-4 overflow-auto data-[state=inactive]:hidden bg-background">
                                <div className="h-full rounded-md border bg-background overflow-hidden flex flex-col">
                                    {clampedLlmResponseBody.truncated && (
                                        <div className="bg-yellow-500/10 text-yellow-600 text-xs p-2 text-center shrink-0 border-b border-yellow-500/20">
                                            응답 바디가 너무 길어 처음 {MAX_LLM_REQUEST_VIEWER_CHARS.toLocaleString()}자까지만 표시됩니다.
                                        </div>
                                    )}
                                    <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground">LLM Raw Response Body</div>
                                    {clampedLlmResponseBody.text ? (
                                        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 p-4 flex-1 overflow-auto">
                                            {clampedLlmResponseBody.text}
                                        </pre>
                                    ) : (
                                        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                                            저장된 LLM 응답 바디가 없습니다.
                                        </div>
                                    )}
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>

                {/* Resizable Divider */}
                <div
                    className="w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex items-center justify-center group shrink-0"
                    onMouseDown={startPanelResize}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/30 rounded-full group-hover:bg-primary/50" />
                </div>

                {/* Right Panel - Extracted Data */}
                <div
                    className="flex flex-col gap-4 overflow-hidden relative"
                    style={{ width: `${rightPanelWidth}px` }}
                >
                    {isProcessing && (
                        <div className="absolute inset-0 z-50 bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-lg border shadow-sm">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                            <p className="text-sm font-medium text-primary animate-pulse">데이터 재추출 중...</p>
                            <p className="text-[10px] text-muted-foreground mt-1 text-center px-4">문서를 다시 분석하여 정밀하게 추출하고 있습니다.</p>
                        </div>
                    )}

                    <Card className="flex-1 overflow-hidden flex flex-col border-none shadow-none bg-transparent">
                        <Tabs defaultValue="edit" className="flex-1 flex flex-col overflow-hidden">
                            <CardHeader className="py-3 px-1 pb-4">
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="bg-chart-2/10 p-2 rounded-xl shrink-0">
                                                <CheckCircle className="w-5 h-5 text-chart-2" />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <h3 className="text-base font-black text-foreground truncate">추출 결과물 검토 및 수정</h3>
                                                <p className="text-[10px] text-muted-foreground truncate">데이터 무결성을 확인하고 필요한 내용을 수정하세요</p>
                                            </div>
                                        </div>

                                        {effectiveModelId && canEditEffectiveModel && (
                                            <TooltipProvider delayDuration={300}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            className="h-9 gap-2 px-4 font-bold shadow-sm hover:shadow-md transition-all border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 shrink-0"
                                                            onClick={() => {
                                                                if (typeof window !== 'undefined') {
                                                                    window.open(`/admin/model-studio?edit=${effectiveModelId}`, '_blank');
                                                                }
                                                            }}
                                                        >
                                                            <Settings className="w-4 h-4" />
                                                            <span className="hidden sm:inline">{isSubModel ? '하위 모델 프롬프트 수정' : '프롬프트 수정'}</span>
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="bottom" align="end" className="text-[10px] font-bold">
                                                        {isSubModel ? '현재 문서의 하위 모델 프롬프트를 수정합니다 (새 탭)' : '모델 프롬프트 수정 (새 탭)'}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between bg-muted/30 p-1 rounded-xl border border-border/50">
                                        <TabsList className="h-9 bg-transparent border-none shadow-none">
                                            <TabsTrigger value="edit" className="text-xs font-bold px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
                                                <Edit className="w-3.5 h-3.5 mr-1.5" />
                                                필드 편집
                                            </TabsTrigger>
                                            <TabsTrigger value="json" className="text-xs font-bold px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg">
                                                <FileJson className="w-3.5 h-3.5 mr-1.5" />
                                                Raw JSON
                                            </TabsTrigger>
                                        </TabsList>

                                        <div className="flex items-center gap-2 px-3">
                                            {isModified && (
                                                <>
                                                    <span className="flex h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                                                    <span className="text-[10px] font-bold text-orange-600">수정됨</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>

                            <TabsContent value="edit" className="flex-1 overflow-hidden m-0 flex flex-col">
                                {previewData?.sub_documents && previewData.sub_documents.length > 0 && (
                                    <div className="px-4 py-1.5 border-b bg-muted/30 flex items-center gap-2 overflow-x-auto overflow-y-hidden scrollbar-hide shrink-0 min-h-11">
                                        <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">문서 선택:</span>
                                        <div className="flex gap-1">
                                            {previewData.sub_documents.map((doc, idx) => (
                                                <Button
                                                    key={idx}
                                                    variant={selectedSubDocIndex === idx ? "default" : "outline"}
                                                    size="sm"
                                                    className="h-7 text-[10px] px-2 py-0"
                                                    onClick={() => onSubDocSelect(idx)}
                                                >
                                                    {doc.type || `문서 ${idx + 1}`}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <CardContent className="h-full overflow-auto space-y-4 pt-4">
                                    {previewData?.sub_documents?.[selectedSubDocIndex]?.history && previewData.sub_documents[selectedSubDocIndex].history!.length > 1 && (
                                        <div className="flex items-center justify-between px-3 py-2.5 mb-2 bg-muted/40 rounded-xl border border-border/40 shadow-sm backdrop-blur-sm transition-all hover:bg-muted/60">
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shadow-inner">
                                                    <History className="w-4 h-4" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-extrabold text-foreground leading-tight tracking-tight">재추출 히스토리</span>
                                                    <span className="text-[10px] text-muted-foreground/80 font-medium tracking-tight">총 {previewData.sub_documents[selectedSubDocIndex].history!.length}개의 버전 보관됨</span>
                                                </div>
                                            </div>

                                            <Select
                                                value={previewData.sub_documents[selectedSubDocIndex].id}
                                                onValueChange={onVersionSwitch}
                                            >
                                                <SelectTrigger className="h-8 text-[11px] font-bold px-3 py-0 min-w-35 bg-background/60 border-border/50 shadow-none hover:bg-background transition-all rounded-lg">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent align="end" className="w-52.5 rounded-xl border-border/60 shadow-2xl backdrop-blur-md">
                                                    {previewData.sub_documents[selectedSubDocIndex].history!.map((h: any, hIdx: number) => {
                                                        const isCurrent = h.id === previewData.sub_documents![selectedSubDocIndex].id;
                                                        const versionNum = previewData.sub_documents![selectedSubDocIndex].history!.length - hIdx;
                                                        return (
                                                            <SelectItem key={h.id} value={h.id} className="text-[12px] py-2.5 rounded-lg focus:bg-primary/5 cursor-pointer">
                                                                <div className="flex flex-col gap-1 w-full mr-2">
                                                                    <div className="flex items-center justify-between w-full gap-2">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-black text-primary">v{versionNum}</span>
                                                                            {hIdx === 0 && (
                                                                                <Badge className="h-4 text-[9px] px-1.5 bg-chart-1 hover:bg-chart-1 border-none text-white font-black tracking-tighter">LATEST</Badge>
                                                                            )}
                                                                        </div>
                                                                        {isCurrent && (
                                                                            <Badge variant="outline" className="h-4 text-[9px] px-1 text-primary border-primary/30 bg-primary/5 font-black">CURRENT</Badge>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-medium">
                                                                        <RefreshCw className="w-2.5 h-2.5" />
                                                                        {dayjs(h.created_at).format('YYYY-MM-DD HH:mm:ss')}
                                                                    </div>
                                                                </div>
                                                            </SelectItem>
                                                        );
                                                    })}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {isModified && (
                                        <div className="flex justify-end mb-2">
                                            <Badge variant="destructive" className="animate-pulse">수정됨</Badge>
                                        </div>
                                    )}
                                    {Object.keys(removeSystemResultKeys(localData)).length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                            데이터가 없습니다.
                                        </p>
                                    ) : (
                                        Object.entries(removeSystemResultKeys(localData)).map(([key, item]: [string, any]) => (
                                            <MemoizedFieldItem
                                                key={key}
                                                fieldKey={key}
                                                value={item}
                                                confidence={(typeof item === 'object' && item !== null && 'confidence' in item) ? item.confidence : null}
                                                isSelected={selectedFieldKey === key}
                                                onFieldSelect={handleFieldSelect}
                                                model={model}
                                                handleValueChange={handleValueChange}
                                                handleObjectChange={handleObjectChange}
                                                handleTableChange={handleTableChange}
                                                handleRowDelete={handleRowDelete}
                                                handleRowAdd={handleRowAdd}
                                                handleTablePaste={handleTablePaste}
                                                handleTableBulkClear={handleTableBulkClear}
                                                handleRowHighlight={handleRowHighlight}
                                                isCollapsed={collapsedFields.has(key)}
                                                toggleFieldCollapse={toggleFieldCollapse}
                                                colWidths={colWidths[key] || EMPTY_OBJ}
                                                startColResize={startColResize}
                                            />
                                        ))
                                    )}
                                </CardContent>
                            </TabsContent>

                            <TabsContent value="json" className="flex-1 overflow-hidden m-0 relative">
                                <div className="absolute right-4 top-2 z-10">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs gap-1.5 bg-background/50 backdrop-blur-sm"
                                        onClick={() => {
                                            navigator.clipboard.writeText(JSON.stringify(removeSystemResultKeys(localData), null, 2));
                                            toast.success('JSON이 클립보드에 복사되었습니다.');
                                        }}
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                        복사
                                    </Button>
                                </div>
                                <CardContent className="h-full pt-12 pb-4">
                                    <pre className="h-full overflow-auto text-[11px] font-mono p-4 bg-muted/50 rounded-lg border">
                                        {JSON.stringify(stripBbox(removeSystemResultKeys(localData)), null, 2)}
                                    </pre>
                                </CardContent>
                            </TabsContent>
                        </Tabs>
                    </Card>

                    <div className="flex flex-col gap-2 p-1">
                        <Button
                            onClick={() => onSave(normalizeLegacyTableRows(removeSystemResultKeys(localData)), [])}
                            disabled={isProcessing || isSendingWebhook}
                            className={cn("w-full shadow-lg", isModified ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground")}
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isModified ? "수정사항 저장 및 완료" : "데이터 확인 완료"}
                        </Button>

                        {!isModified && onSendWebhook && (
                            hasWebhookUrl ? (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            disabled={isProcessing || isSendingWebhook}
                                            variant="outline"
                                            className="w-full border-primary/20 hover:border-primary/50 text-primary gap-2"
                                        >
                                            {isSendingWebhook ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Send className="w-4 h-4" />
                                            )}
                                            Webhook 전달 (데이터 내보내기)
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Webhook 데이터 전송 확인</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                현재 검토된 데이터를 Webhook으로 전송하시겠습니까?<br />
                                                이 작업은 ERP 시스템으로 데이터를 내보내며 되돌릴 수 없습니다.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={onSendWebhook}
                                                className="bg-primary text-primary-foreground hover:bg-primary/90"
                                            >
                                                전송하기
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            ) : (
                                <Button
                                    disabled
                                    variant="outline"
                                    className="w-full border-primary/20 text-primary gap-2 opacity-60"
                                >
                                    <Send className="w-4 h-4" />
                                    Webhook 전달 (데이터 내보내기)
                                </Button>
                            )
                        )}

                        <Button variant="ghost" onClick={onRetry} disabled={isProcessing} className="w-full text-xs h-8">
                            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isProcessing && "animate-spin")} />
                            재추출
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
