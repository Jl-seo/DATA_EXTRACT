'use client';

import { useState } from 'react';
import { useStartExtraction, useExtractionLog } from '@/queries/extraction';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Upload, FileText, CheckCircle, AlertCircle, X, Camera } from 'lucide-react';
import { toast } from 'sonner';

import { useUploadFile } from '@/hooks/useUploadFile';

// Simplified Quick Extraction (Mock Universal Model)
export function QuickExtraction() {
    const startExtraction = useStartExtraction();
    const { upload, isLoading: isUploading } = useUploadFile();

    const [currentLogId, setCurrentLogId] = useState<string | null>(null);

    const { data: log } = useExtractionLog(currentLogId || '');

    // Using a fixed "system-universal" model ID for quick extraction
    // Ensure this model exists in DB or is handled specially in backend.
    // For now we assume a model with ID 'system-universal' exists.
    const UNIVERSAL_MODEL_ID = 'system-universal';

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        // setUploading(true); // Handled by hook

        try {
            const file = e.target.files[0];
            const { fileId } = await upload(file);

            const result = await startExtraction.mutateAsync({
                fileId: fileId,
                modelId: UNIVERSAL_MODEL_ID
            });
            if (result) setCurrentLogId(result.id);
            toast.success("분석 시작됨");

        } catch (err) {
            console.error(err);
            toast.error("업로드 실패");
            // setUploading(false); // Handled by hook
        }
    };

    const handleReset = () => {
        setCurrentLogId(null);
    };

    const status = log?.status;

    return (
        <Card className="h-full min-h-[500px]">
            <CardContent className="p-6 h-full flex flex-col">
                {!currentLogId ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors">
                        <Upload className="w-16 h-16 text-primary mb-6" />
                        <h3 className="text-xl font-bold mb-2">빠른 추출 시작하기</h3>
                        <p className="text-muted-foreground mb-8 text-center max-w-sm">
                            모델 설정 없이 문서를 즉시 분석합니다.<br />
                            이미지, PDF, 스캔 문서를 지원합니다.
                        </p>

                        <input
                            type="file"
                            id="quick-upload"
                            className="hidden"
                            onChange={handleFileChange}
                            disabled={isUploading}
                        />
                        <Button asChild size="lg" disabled={isUploading}>
                            <label htmlFor="quick-upload" className="cursor-pointer">
                                {isUploading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <FileText className="w-5 h-5 mr-2" />}
                                {isUploading ? '업로드 중...' : '파일 선택'}
                            </label>
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <FileText className="w-5 h-5" />
                                {log?.filename || '문서 분석'}
                            </h3>
                            <Button variant="ghost" onClick={handleReset}><X className="w-5 h-5" /></Button>
                        </div>

                        <div className="flex items-center gap-4 p-6 bg-muted rounded-lg justify-center">
                            {status === 'processing' && (
                                <div className="text-center">
                                    <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-2" />
                                    <p className="font-semibold">AI가 문서를 분석하고 있습니다...</p>
                                </div>
                            )}
                            {status === 'success' && (
                                <div className="text-center w-full">
                                    <div className="flex items-center justify-center gap-2 mb-4 text-green-600">
                                        <CheckCircle className="w-6 h-6" />
                                        <span className="font-bold">분석 완료</span>
                                    </div>

                                    {/* Simple KV View for Quick Extraction */}
                                    {log?.extracted_data && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                                            {Object.entries(log.extracted_data).map(([key, item]: any) => (
                                                <Card key={key} className="p-4">
                                                    <div className="text-xs text-muted-foreground uppercase">{key}</div>
                                                    <div className="font-medium mt-1 truncate">{String(item.value)}</div>
                                                </Card>
                                            ))}
                                        </div>
                                    )}

                                    <Button onClick={handleReset} className="mt-8" variant="outline">다른 문서 분석</Button>
                                </div>
                            )}
                            {status === 'error' && (
                                <div className="text-center text-red-500">
                                    <AlertCircle className="w-10 h-10 mx-auto mb-2" />
                                    <p className="font-bold">분석 실패</p>
                                    <p className="text-sm mt-2">{log?.error_message}</p>
                                    <Button onClick={handleReset} className="mt-4" variant="outline">다시 시도</Button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
