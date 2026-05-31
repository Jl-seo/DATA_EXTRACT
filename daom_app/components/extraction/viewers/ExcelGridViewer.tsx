/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, memo } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Grid, type GridImperativeAPI } from 'react-window';

interface ExcelGridViewerProps {
    fileUrl: string;
}

interface SheetData {
    name: string;
    rows: string[][];
    rowCount: number;
    colCount: number;
    colWidths: number[];
}

export interface ExcelGridViewerHandle {
    // We can keep the handle for future use or remove it. 
    // Since it's used in ExtractionReviewView, keeping it with an empty implementation prevents breakages.
    scrollToHighlight: (fieldKey: string) => void;
}

// Simple AutoSizer component to avoid extra dependency
const AutoSizer = ({ children }: { children: (size: { width: number, height: number }) => React.ReactNode }) => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setSize({ width, height });
            }
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            {size.width > 0 && size.height > 0 && children(size)}
        </div>
    );
};

// Memoized Cell Component
const CellComponent = memo(({ 
    columnIndex, 
    rowIndex, 
    style, 
    rows 
}: any) => {
    // Column 0 is the Row Number (Row Index)
    if (columnIndex === 0) {
        return (
            <div
                style={style}
                className="px-2 py-1 border-r border-b text-[10px] flex items-center justify-center bg-muted/30 text-muted-foreground font-medium select-none"
            >
                {rowIndex + 1}
            </div>
        );
    }

    // Actual Data (offset by 1)
    const cell = rows[rowIndex]?.[columnIndex - 1] || '';

    return (
        <div
            style={style}
            className="px-2 py-1 border-r border-b truncate transition-colors text-[11px] flex items-center bg-background"
            title={cell}
        >
            {cell}
        </div>
    );
});
CellComponent.displayName = 'CellComponent';

export const ExcelGridViewer = forwardRef<ExcelGridViewerHandle, ExcelGridViewerProps>(({
    fileUrl
}, ref) => {
    const [sheets, setSheets] = useState<SheetData[]>([]);
    const [activeSheetIndex, setActiveSheetIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const gridRef = useRef<GridImperativeAPI>(null);

    useEffect(() => {
        if (!fileUrl) return;
        const fetchExcelData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(fileUrl);
                const arrayBuffer = await response.arrayBuffer();
                const XLSX = await import('xlsx');
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });

                const parsedSheets: SheetData[] = workbook.SheetNames.map((name) => {
                    const sheet = workbook.Sheets[name];
                    const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
                    const rows = jsonData.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []);
                    const rowCount = rows.length;
                    const colCount = Math.max(...rows.map(r => r.length), 0);
                    const normalizedRows = rows.map(row => {
                        const padded = [...row];
                        while (padded.length < colCount) padded.push('');
                        return padded;
                    });

                    // Calculate dynamic column widths based on content
                    const colWidths = Array(colCount).fill(100).map((_, colIdx) => {
                        // Sample up to 1000 rows for performance on extremely large sheets
                        const sampleRows = normalizedRows.length > 1000 ? normalizedRows.slice(0, 1000) : normalizedRows;
                        const maxChars = Math.max(...sampleRows.map(row => (row[colIdx] || '').length), 2);
                        return Math.min(500, Math.max(100, maxChars * 8 + 20));
                    });

                    return { name, rows: normalizedRows, rowCount, colCount, colWidths };
                });
                setSheets(parsedSheets);
            } catch (e: any) {
                console.error('[ExcelGridViewer] Failed to load Excel:', e);
                setError(e?.message || 'Failed to load Excel file');
            } finally {
                setLoading(false);
            }
        };
        fetchExcelData();
    }, [fileUrl]);

    const currentSheet = sheets[activeSheetIndex];

    useImperativeHandle(ref, () => ({
        scrollToHighlight: (fieldKey: string) => {
            // Highlight feature removed per user request
            console.log('Scroll to highlight ignored for Excel:', fieldKey);
        }
    }), []);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-muted/20">
                <div className="text-center space-y-2">
                    <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Excel 데이터를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    if (error || !sheets.length) {
        return (
            <div className="h-full flex items-center justify-center bg-muted/20 p-6 text-center">
                <div className="space-y-2">
                    <FileSpreadsheet className="w-10 h-10 mx-auto text-destructive/50" />
                    <p className="text-sm text-destructive font-bold">{error || 'Excel 데이터를 찾을 수 없습니다.'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {sheets.length > 1 && (
                <div className="flex items-center bg-background border-b overflow-x-auto shrink-0 scrollbar-hide">
                    {sheets.map((sheet, idx) => (
                        <button
                            key={sheet.name}
                            onClick={() => setActiveSheetIndex(idx)}
                            className={cn(
                                "px-6 py-2.5 text-[11px] font-bold transition-all whitespace-nowrap border-b-2",
                                idx === activeSheetIndex
                                    ? "text-primary border-primary bg-background"
                                    : "text-muted-foreground border-transparent hover:bg-muted/30"
                            )}
                        >
                            {sheet.name}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative bg-background">
                <AutoSizer>
                    {({ height, width }) => (
                        <Grid
                            gridRef={gridRef}
                            columnCount={currentSheet.colCount + 1}
                            columnWidth={(index) => index === 0 ? 40 : (currentSheet.colWidths[index - 1] || 120)}
                            rowCount={currentSheet.rowCount}
                            rowHeight={28}
                            className="scrollbar-thin"
                            style={{ height, width }}
                            cellComponent={CellComponent as any}
                            cellProps={{
                                rows: currentSheet.rows
                            }}
                        />
                    )}
                </AutoSizer>
            </div>

            <div className="px-3 py-1 bg-muted/50 border-t text-[10px] text-muted-foreground font-mono flex justify-between shrink-0">
                <span>GRID: {currentSheet.rowCount}행 × {currentSheet.colCount}열</span>
                <span>SHEET {activeSheetIndex + 1} / {sheets.length}</span>
            </div>
        </div>
    );
});

ExcelGridViewer.displayName = 'ExcelGridViewer';
