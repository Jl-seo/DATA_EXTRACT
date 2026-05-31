import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

interface OcrTextViewerProps {
    ocrText?: string;
    llmTaggedText?: string;
    showTaggedText?: boolean;
    rawTables?: unknown[];
    tableBatchInputs?: unknown[];
}

const MAX_VIEWER_CHARS = 500000;

function clampViewerText(text: string): { text: string; truncated: boolean } {
    if (text.length > MAX_VIEWER_CHARS) {
        return {
            text: text.slice(0, MAX_VIEWER_CHARS),
            truncated: true,
        };
    }

    return {
        text,
        truncated: false,
    };
}

/**
 * Shared OCR text viewer component.
 * OCR 원본 텍스트만 표시한다.
 */
export function OcrTextViewer({ ocrText }: OcrTextViewerProps) {
    const [deferredText, setDeferredText] = useState<string>('');
    const [isTruncated, setIsTruncated] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            const source = ocrText || '';
            const clamped = clampViewerText(source);
            setDeferredText(clamped.text);
            setIsTruncated(clamped.truncated);
        }, 100);

        return () => clearTimeout(timer);
    }, [ocrText]);

    const hasOcr = !!ocrText;

    if (!hasOcr) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                <FileText className="w-12 h-12 mb-4 opacity-20" />
                <p>OCR 텍스트가 없습니다.</p>
                <p className="text-xs mt-2 opacity-60">
                    문서가 아직 분석되지 않았거나 텍스트를 추출할 수 없습니다.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full">
            {isTruncated && (
                <div className="bg-yellow-500/10 text-yellow-600 text-xs p-2 text-center shrink-0 border-b border-yellow-500/20">
                    문서 텍스트가 너무 길어 시스템 보호를 위해 처음 {MAX_VIEWER_CHARS.toLocaleString()}자까지만 화면에 표시됩니다. (실제 데이터 추출은 100% 정상 진행됩니다)
                </div>
            )}
            <div className="min-h-0 min-w-0 w-full rounded-md border bg-background overflow-hidden flex flex-col h-full">
                <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground">OCR 원본 텍스트</div>
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 p-4 flex-1 overflow-auto">
                    {deferredText || '텍스트 렌더링 중... 잠시만 기다려주세요.'}
                </pre>
            </div>
        </div>
    );
}
