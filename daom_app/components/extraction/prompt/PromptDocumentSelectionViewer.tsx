'use client';

import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PromptSelection } from '@/scheme/promptProfile';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type FileKind = 'pdf' | 'image' | 'unsupported';

type DraftRect = {
  pageNumber: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

function resolveFileKind(filename: string): FileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image';
  return 'unsupported';
}

function toSelectionBBox(draft: DraftRect, viewportRect: DOMRect) {
  const minX = Math.max(0, Math.min(draft.startX, draft.currentX));
  const minY = Math.max(0, Math.min(draft.startY, draft.currentY));
  const maxX = Math.min(viewportRect.width, Math.max(draft.startX, draft.currentX));
  const maxY = Math.min(viewportRect.height, Math.max(draft.startY, draft.currentY));
  const width = maxX - minX;
  const height = maxY - minY;

  const normalized = {
    x: Math.round((minX / viewportRect.width) * 1000),
    y: Math.round((minY / viewportRect.height) * 1000),
    width: Math.round((width / viewportRect.width) * 1000),
    height: Math.round((height / viewportRect.height) * 1000),
  };
  return { ...normalized, widthPx: width, heightPx: height };
}

function styleFromSelection(selection: PromptSelection) {
  return {
    left: `${(selection.bbox.x / 1000) * 100}%`,
    top: `${(selection.bbox.y / 1000) * 100}%`,
    width: `${(selection.bbox.width / 1000) * 100}%`,
    height: `${(selection.bbox.height / 1000) * 100}%`,
  };
}

type PromptDocumentSelectionViewerProps = {
  fileUrl: string;
  filename: string;
  selections: PromptSelection[];
  onChange: (next: PromptSelection[]) => void;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('[data-selection-control="true"]');
}

export function PromptDocumentSelectionViewer({
  fileUrl,
  filename,
  selections,
  onChange,
}: PromptDocumentSelectionViewerProps) {
  const fileKind = useMemo(() => resolveFileKind(filename), [filename]);
  const [numPages, setNumPages] = useState(0);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);

  const removeSelection = (selectionId: string) => {
    const next = selections.filter((selection) => selection.id !== selectionId);
    onChange(next);
  };

  const beginDraw = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    setDraftRect({
      pageNumber,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });
  };

  const moveDraw = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (!draftRect || draftRect.pageNumber !== pageNumber) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraftRect({
      ...draftRect,
      currentX: event.clientX - rect.left,
      currentY: event.clientY - rect.top,
    });
  };

  const endDraw = (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (!draftRect || draftRect.pageNumber !== pageNumber) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const bbox = toSelectionBBox(draftRect, rect);
    setDraftRect(null);

    if (bbox.widthPx < 8 || bbox.heightPx < 8) return;

    const nextSelection: PromptSelection = {
      id: crypto.randomUUID(),
      page_number: pageNumber,
      bbox: {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      },
      label: `영역 ${selections.length + 1}`,
      note: '',
      order: selections.length,
    };

    onChange([...selections, nextSelection]);
  };

  const renderSelectionLayer = (pageNumber: number) => {
    const pageSelections = selections.filter((selection) => selection.page_number === pageNumber);
    return (
      <div className="absolute inset-0">
        {pageSelections.map((selection) => (
          <div
            key={selection.id}
            className="group absolute border-2 border-primary bg-primary/15"
            style={styleFromSelection(selection)}
          >
            <div className="absolute left-0 top-0 -translate-y-full rounded-t-sm bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
              {selection.label}
            </div>
            <button
              type="button"
              data-selection-control="true"
              className="absolute right-0 top-0 hidden -translate-y-1/2 translate-x-1/2 rounded-full border bg-background p-0.5 text-destructive group-hover:block"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                removeSelection(selection.id);
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {draftRect && draftRect.pageNumber === pageNumber && (
          <div
            className="absolute border border-dashed border-primary bg-primary/20"
            style={{
              left: `${Math.min(draftRect.startX, draftRect.currentX)}px`,
              top: `${Math.min(draftRect.startY, draftRect.currentY)}px`,
              width: `${Math.abs(draftRect.currentX - draftRect.startX)}px`,
              height: `${Math.abs(draftRect.currentY - draftRect.startY)}px`,
            }}
          />
        )}
      </div>
    );
  };

  if (fileKind === 'unsupported') {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        PDF/PNG/JPG 파일만 범위 선택을 지원합니다.
      </div>
    );
  }

  if (fileKind === 'image') {
    return (
      <div className="overflow-auto rounded-lg border bg-muted/10 p-3">
        <div
          className={cn(
            'relative mx-auto w-fit select-none',
            draftRect ? 'cursor-crosshair' : 'cursor-crosshair'
          )}
          onMouseDown={(event) => beginDraw(event, 1)}
          onMouseMove={(event) => moveDraw(event, 1)}
          onMouseUp={(event) => endDraw(event, 1)}
        >
          <img src={fileUrl} alt={filename} className="max-h-[70vh] max-w-full rounded border bg-white object-contain" />
          {renderSelectionLayer(1)}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border bg-muted/10 p-3">
      <Document
        file={fileUrl}
        className="mx-auto flex w-fit flex-col gap-4"
        onLoadSuccess={({ numPages: loadedPages }) => setNumPages(loadedPages)}
        loading={
          <div className="flex h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            PDF 로딩 중...
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, index) => {
          const pageNumber = index + 1;
          return (
            <div
              key={pageNumber}
              className="relative w-fit"
              onMouseDown={(event) => beginDraw(event, pageNumber)}
              onMouseMove={(event) => moveDraw(event, pageNumber)}
              onMouseUp={(event) => endDraw(event, pageNumber)}
            >
              <Page pageNumber={pageNumber} renderAnnotationLayer={false} renderTextLayer={false} />
              {renderSelectionLayer(pageNumber)}
              <div className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                {pageNumber}/{numPages}
              </div>
            </div>
          );
        })}
      </Document>
    </div>
  );
}
