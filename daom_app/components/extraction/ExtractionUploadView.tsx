'use client';

import { useRef, useState } from 'react';
import { Upload, FileText, AlertTriangle, X, Loader2, Plus, Barcode } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ExtractionModel, ExtractionStatus } from './types';
import { EXTRACTION_STATUS, STATUS_LABELS, isErrorStatus, isProcessingStatus } from './constants/status';
import { useExtraction } from './context/ExtractionContext';
import { useMultifileUploadFeature } from '@/queries/env';
import { BarcodeScannerDialog } from './barcode/BarcodeScannerDialog';

type UploadStartOptions = {
    uploadMode?: 'single' | 'multi-separate' | 'multi-merged';
    multiFiles?: File[];
};

interface ExtractionUploadViewProps {
    file: File | null;
    status: ExtractionStatus;
    error?: string | null;
    model: ExtractionModel | null;
    forcedUploadMode?: 'single' | 'multi';
    onFileSelect: (file: File, candidateFiles?: File[], options?: UploadStartOptions) => void;
    onCancel: () => void;
}

export function ExtractionUploadView({
    file: _file,
    status,
    error,
    model,
    forcedUploadMode = 'single',
    onFileSelect,
    onCancel
}: ExtractionUploadViewProps) {
    const { data: isMultifileUploadEnabled = false } = useMultifileUploadFeature();
    const { uploadProgress } = useExtraction();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const [selectedBaseline, setSelectedBaseline] = useState<File | null>(null);
    const [selectedCandidates, setSelectedCandidates] = useState<File[]>([]);
    const candidateInputRef = useRef<HTMLInputElement>(null);
    const multiFileInputRef = useRef<HTMLInputElement>(null);
    const [selectedUploadMode, setSelectedUploadMode] = useState<'multi-separate' | 'multi-merged'>(
        model?.beta_features?.multifile_strategy === 'merged' ? 'multi-merged' : 'multi-separate'
    );
    const [selectedMultiFiles, setSelectedMultiFiles] = useState<File[]>([]);
    const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);

    const isBarcodeScanEnabled = model?.beta_features?.enable_barcode_scan === true;
    const defaultBarcodeScanMode = model?.beta_features?.barcode_multi_scan === true ? 'multi' : 'single';

    const handleFileSelect = (selectedFile: File | null | undefined) => {
        if (selectedFile) onFileSelect(selectedFile);
    };

    const isActiveProcessing = isProcessingStatus(status) && status !== 'idle';

    const getProcessingMessage = () => {
        return STATUS_LABELS[status] || '처리 중...';
    };

    // Processing state
    if (isActiveProcessing) {
        const isUploading = status === EXTRACTION_STATUS.UPLOADING;

        return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-slate-50/30">
                <div className="mb-10 relative">
                    {isUploading ? (
                        <div className="w-24 h-24 rounded-full border-4 border-slate-100 flex items-center justify-center bg-white shadow-sm">
                            <Upload className="w-10 h-10 text-primary animate-bounce" />
                        </div>
                    ) : (
                        <div className="w-24 h-24 rounded-full border-4 border-slate-100 flex items-center justify-center bg-white shadow-sm">
                            <Loader2 className="w-10 h-10 text-primary animate-spin" />
                        </div>
                    )}
                </div>

                <div className="max-w-md w-full mb-8">
                    <div className="flex justify-between items-end mb-3">
                        <div className="text-left">
                            <h2 className="text-2xl font-bold text-slate-800 transition-all duration-500">
                                {getProcessingMessage()}
                            </h2>
                            <p className="text-slate-500 text-sm mt-1 transition-all duration-500">
                                {isUploading ? '대용량 파일은 다소 시간이 걸릴 수 있습니다.' : '문서의 레이아웃과 텍스트를 정밀하게 분석 중입니다.'}
                            </p>
                        </div>
                        {isUploading ? (
                            <span className="text-2xl font-black text-primary tabular-nums">
                                {Math.round(uploadProgress)}%
                            </span>
                        ) : (
                            <div className="flex gap-1 mb-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></span>
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></span>
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"></span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        {isUploading ? (
                            <>
                                <Progress value={uploadProgress} className="h-3 shadow-inner bg-slate-100 transition-all duration-500" />
                                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                                    <span>Starting Upload</span>
                                    <span>Ready to Process</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner relative">
                                    <div className="absolute top-0 left-0 h-full bg-primary w-1/3 animate-indeterminate-progress rounded-full"></div>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                                    <span>Layout Analysis</span>
                                    <span>Data Extraction</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <Button variant="ghost" onClick={onCancel} className="text-slate-400 hover:text-slate-800">
                    작업 취소
                </Button>
            </div>
        );
    }
    const isComparisonMode = model?.model_type === 'comparison';

    // Comparison Mode Upload View
    if (isComparisonMode) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold mb-2">비교 분석 문서 업로드</h2>
                    <p className="text-muted-foreground text-sm">기준 문서와 비교할 대상 문서들을 업로드해 주세요.</p>
                </div>

                <div className="flex gap-6 w-full max-w-5xl h-[350px]">
                    {/* Baseline Upload */}
                    <Card
                        className={cn(
                            "flex-1 flex flex-col items-center justify-center border-2 border-dashed transition-all duration-300 relative cursor-pointer",
                            selectedBaseline ? "border-primary bg-primary/5 shadow-sm" : "border-muted-foreground/20 hover:border-primary/50"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div className="absolute top-4 left-4 flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            <FileText className="w-3.5 h-3.5" />
                            기준 문서 (Baseline)
                        </div>
                        {selectedBaseline ? (
                            <div className="flex flex-col items-center text-primary">
                                <FileText className="w-10 h-10 mb-3" />
                                <span className="text-sm truncate max-w-[180px] font-semibold">{selectedBaseline.name}</span>
                                <Button variant="ghost" size="sm" className="mt-4 h-7 text-xs text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setSelectedBaseline(null); }}>변경하기</Button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center text-muted-foreground">
                                <Upload className="w-10 h-10 mb-3 opacity-50" />
                                <span className="text-sm font-medium">업로드할 기준 문서 선택</span>
                                <span className="text-[10px] mt-1">PDF, Excel, JPG, PNG 지원</span>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
                            onChange={(e) => setSelectedBaseline(e.target.files?.[0] || null)}
                            className="hidden"
                        />
                    </Card>

                    {/* Candidate Upload (Multi-Select) */}
                    <Card
                        className={cn(
                            "flex-[1.5] flex flex-col items-center justify-start border-2 border-dashed transition-all duration-300 relative overflow-hidden",
                            selectedCandidates.length > 0 ? "border-primary bg-primary/5 shadow-sm" : "border-muted-foreground/20 hover:border-primary/50"
                        )}
                    >
                        <div className="w-full p-3 border-b bg-muted/20 text-center shrink-0 flex items-center justify-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">비교 대상 (Candidates)</span>
                            <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold">{selectedCandidates.length}건</span>
                        </div>

                        <div className="flex-1 w-full p-4 overflow-y-auto custom-scrollbar flex flex-col items-center justify-start gap-2">
                            {selectedCandidates.length > 0 ? (
                                <div className="w-full grid grid-cols-1 gap-2">
                                    {selectedCandidates.map((file, idx) => (
                                        <div key={idx} className="flex items-center justify-between bg-background p-2.5 rounded-lg border text-sm shadow-sm group hover:border-primary/30 transition-colors">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                                    <FileText className="w-4 h-4 text-primary" />
                                                </div>
                                                <span className="truncate max-w-[220px] font-medium">{file.name}</span>
                                            </div>
                                            <button
                                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-all"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedCandidates(prev => prev.filter((_, i) => i !== idx));
                                                }}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-2 border-dashed h-10 text-xs font-semibold text-muted-foreground hover:text-primary"
                                        onClick={() => candidateInputRef.current?.click()}
                                    >
                                        <Plus className="w-3.5 h-3.5 mr-1.5" /> 비교 대상 추가하기
                                    </Button>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground cursor-pointer w-full" onClick={() => candidateInputRef.current?.click()}>
                                    <Upload className="w-10 h-10 mb-3 opacity-50" />
                                    <span className="text-sm font-medium">업로드할 비교 대상 선택 (다중 선택 가능)</span>
                                    <span className="text-[10px] mt-1 text-center font-normal">비교하고 싶은 문서들을 한꺼번에 선택하거나<br />여러 번 나누어 업로드할 수 있습니다.</span>
                                </div>
                            )}
                        </div>

                        <input
                            ref={candidateInputRef}
                            type="file"
                            multiple
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
                            onChange={(e) => {
                                if (e.target.files) {
                                    const newFiles = Array.from(e.target.files);
                                    setSelectedCandidates(prev => [...prev, ...newFiles]);
                                    e.target.value = '';
                                }
                            }}
                            className="hidden"
                        />
                    </Card>
                </div>

                <div className="mt-10 flex items-center gap-4">
                    <Button variant="ghost" onClick={onCancel} className="text-muted-foreground">
                        취소
                    </Button>
                    <Button
                        size="lg"
                        className="px-10 h-12 font-bold shadow-lg"
                        disabled={!selectedBaseline || selectedCandidates.length === 0}
                        onClick={() => {
                            if (selectedBaseline && selectedCandidates.length > 0) {
                                onFileSelect(selectedBaseline, selectedCandidates);
                            }
                        }}
                    >
                        비교 분석 시작 ({selectedCandidates.length}건)
                    </Button>
                </div>
            </div>
        );
    }

    const shouldShowMultifileUpload = isMultifileUploadEnabled && forcedUploadMode === 'multi';
    if (shouldShowMultifileUpload) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="w-full max-w-4xl space-y-6">
                    <div className="text-center">
                        <h2 className="text-2xl font-bold mb-2">다중문서 업로드</h2>
                        <p className="text-muted-foreground text-sm">여러 문서를 한 번에 업로드하고 처리 방식을 선택하세요.</p>
                        {isBarcodeScanEnabled && (
                            <div className="mt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsBarcodeScannerOpen(true)}
                                >
                                    <Barcode className="w-4 h-4 mr-2" />
                                    바코드 스캔
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <button
                            type="button"
                            className={cn(
                                'rounded-lg border p-4 text-left transition-colors',
                                selectedUploadMode === 'multi-separate'
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50'
                            )}
                            onClick={() => setSelectedUploadMode('multi-separate')}
                        >
                            <p className="font-semibold">개별 추출</p>
                            <p className="text-xs text-muted-foreground mt-1">파일마다 독립 추출 로그를 생성합니다.</p>
                        </button>
                        <button
                            type="button"
                            className={cn(
                                'rounded-lg border p-4 text-left transition-colors',
                                selectedUploadMode === 'multi-merged'
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:border-primary/50'
                            )}
                            onClick={() => setSelectedUploadMode('multi-merged')}
                        >
                            <p className="font-semibold">통합 추출</p>
                            <p className="text-xs text-muted-foreground mt-1">여러 문서 결과를 합쳐 1건으로 추출합니다.</p>
                        </button>
                    </div>

                    <Card
                        className={cn(
                            'w-full min-h-[320px] flex flex-col items-center justify-center border-2 border-dashed transition-all duration-300 relative overflow-hidden cursor-pointer',
                            isDragging
                                ? 'border-primary bg-primary/5 shadow-lg scale-[1.01]'
                                : 'border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30'
                        )}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            const droppedFiles = Array.from(e.dataTransfer.files || []);
                            if (droppedFiles.length > 0) {
                                setSelectedMultiFiles((prev) => [...prev, ...droppedFiles]);
                            }
                        }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                        onClick={() => multiFileInputRef.current?.click()}
                    >
                        {selectedMultiFiles.length === 0 ? (
                            <div className="flex flex-col items-center">
                                <div className={cn(
                                    'w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors',
                                    isDragging ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                                )}>
                                    <Upload className="w-10 h-10" />
                                </div>
                                <h3 className="text-xl font-bold mb-2">파일을 드래그하여 업로드</h3>
                                <p className="text-muted-foreground mb-8 text-center max-w-xs">
                                    또는 클릭하여 다중 선택<br />PDF, Excel, JPG, PNG 지원
                                </p>
                                <Button size="lg" className="min-w-[200px]">파일 다중 선택</Button>
                            </div>
                        ) : (
                            <div className="w-full max-w-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-sm font-semibold">선택 파일 ({selectedMultiFiles.length}건)</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            multiFileInputRef.current?.click();
                                        }}
                                    >
                                        <Plus className="w-4 h-4 mr-1" />
                                        파일 추가
                                    </Button>
                                </div>
                                <div className="space-y-2 max-h-48 overflow-auto">
                                    {selectedMultiFiles.map((targetFile, index) => (
                                        <div key={`${targetFile.name}-${index}`} className="flex items-center justify-between bg-background rounded-md border px-3 py-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <FileText className="w-4 h-4 text-primary shrink-0" />
                                                <span className="text-sm truncate">{targetFile.name}</span>
                                            </div>
                                            <button
                                                type="button"
                                                className="text-muted-foreground hover:text-destructive"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedMultiFiles((prev) => prev.filter((_, idx) => idx !== index));
                                                }}
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <input
                            ref={multiFileInputRef}
                            type="file"
                            multiple
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
                            onChange={(e) => {
                                if (!e.target.files) return;
                                const newFiles = Array.from(e.target.files);
                                setSelectedMultiFiles((prev) => [...prev, ...newFiles]);
                                e.target.value = '';
                            }}
                            className="hidden"
                        />
                    </Card>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
                        <Button
                            size="lg"
                            className="h-12 px-10 font-bold shadow-lg sm:min-w-[320px]"
                            disabled={selectedMultiFiles.length === 0}
                            onClick={() => {
                                if (selectedMultiFiles.length === 0) return;
                                onFileSelect(
                                    selectedMultiFiles[0],
                                    undefined,
                                    {
                                        uploadMode: selectedUploadMode,
                                        multiFiles: selectedMultiFiles,
                                    }
                                );
                            }}
                        >
                            {selectedUploadMode === 'multi-merged'
                                ? `통합 추출 시작 (${selectedMultiFiles.length}건)`
                                : `개별 추출 시작 (${selectedMultiFiles.length}건)`}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={onCancel}
                            className="h-12 bg-muted px-6 text-muted-foreground hover:bg-muted/80 sm:min-w-[88px]"
                        >
                            취소
                        </Button>
                    </div>
                </div>
                {isBarcodeScanEnabled && (
                    <BarcodeScannerDialog
                        open={isBarcodeScannerOpen}
                        onOpenChange={setIsBarcodeScannerOpen}
                        defaultScanMode={defaultBarcodeScanMode}
                    />
                )}
            </div>
        );
    }

    // Default Extraction Upload View
    return (
        <div className="h-full flex flex-col items-center justify-center p-8">
            {isBarcodeScanEnabled && (
                <div className="w-full max-w-2xl mb-3 flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsBarcodeScannerOpen(true)}
                    >
                        <Barcode className="w-4 h-4 mr-2" />
                        바코드 스캔
                    </Button>
                </div>
            )}
            <Card
                className={cn(
                    "w-full max-w-2xl h-[400px] flex flex-col items-center justify-center border-2 border-dashed transition-all duration-300 relative overflow-hidden cursor-pointer",
                    isDragging
                        ? "border-primary bg-primary/5 shadow-lg scale-[1.02]"
                        : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
                )}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFileSelect(e.dataTransfer.files?.[0]);
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="flex flex-col items-center z-10">
                    <div className={cn(
                        "w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors",
                        isDragging ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                    )}>
                        <Upload className="w-10 h-10" />
                    </div>

                    <h3 className="text-xl font-bold mb-2">파일을 드래그하여 업로드</h3>
                    <p className="text-muted-foreground mb-8 text-center max-w-xs">
                        또는 클릭하여 파일 선택<br />PDF, Excel, JPG, PNG 지원
                    </p>

                    <Button size="lg" className="min-w-[180px]">
                        파일 선택
                    </Button>
                </div>

                {/* Error Banner */}
                {isErrorStatus(status) && error && (
                    <div className="absolute bottom-0 left-0 right-0 bg-destructive text-destructive-foreground p-4 text-center text-sm font-medium flex items-center justify-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                    className="hidden"
                />
            </Card>

            <div className="mt-8">
                <Button variant="ghost" onClick={onCancel}>
                    <X className="w-4 h-4 mr-2" /> 목록으로 돌아가기
                </Button>
            </div>
            {isBarcodeScanEnabled && (
                <BarcodeScannerDialog
                    open={isBarcodeScannerOpen}
                    onOpenChange={setIsBarcodeScannerOpen}
                    defaultScanMode={defaultBarcodeScanMode}
                />
            )}
        </div>
    );
}
