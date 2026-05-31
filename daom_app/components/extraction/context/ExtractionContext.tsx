'use client';

import { createContext, useContext, useState, useRef, type ReactNode, useCallback, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EXTRACTION_STATUS, isSuccessStatus } from '../constants/status';
import type {
    ViewStep,
    ExtractionStatus,
    SubDocument,
    PreviewData,
    ExtractionModel,
    ExtractionLog,
    Highlight
} from '../types';
import { POLLING_INTERVAL_MS } from '../constants';
import { generateUploadSasUrl, confirmFileUpload } from '@/actions/file';
import { startExtraction, startMultiExtraction, updateExtractionData, retryExtraction, triggerExtractionWebhook } from '@/actions/extraction';
import { getExtractionModel } from '@/actions/extractionModel';
import { getExtractionPermissionSummary } from '@/actions/permission';
import {
    canEditExtractionModel,
    EMPTY_EXTRACTION_PERMISSION_SUMMARY,
    type ExtractionPermissionSummary,
} from '@/lib/extractionPermission';

// Development-only logging helper
const devLog = (...args: unknown[]) => {
    if (process.env.NODE_ENV === 'development') {
        console.log(...args);
    }
};

const IMAGE_UPLOAD_MAX_LONG_EDGE = 2560;
const IMAGE_UPLOAD_QUALITY = 0.85;
const IMAGE_UPLOAD_MIN_COMPRESS_SIZE_BYTES = 2 * 1024 * 1024;

const isCompressibleImageFile = (file: File): boolean => {
    if (!file.type || !file.type.startsWith('image/')) return false;
    return file.type !== 'image/gif';
};

const getScaledDimensions = (width: number, height: number, maxLongEdge: number): { width: number; height: number } => {
    const longEdge = Math.max(width, height);
    if (longEdge <= maxLongEdge) {
        return { width, height };
    }
    const scale = maxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};

const buildRenamedFilename = (originalName: string, nextExtension: string): string => {
    const dotIndex = originalName.lastIndexOf('.');
    if (dotIndex === -1) return `${originalName}${nextExtension}`;
    return `${originalName.slice(0, dotIndex)}${nextExtension}`;
};

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => (
    new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('이미지 로드 실패'));
        };
        image.src = objectUrl;
    })
);

const compressImageForUpload = async (file: File): Promise<File> => {
    if (!isCompressibleImageFile(file)) return file;

    try {
        const image = await loadImageFromFile(file);
        const originWidth = image.naturalWidth || image.width;
        const originHeight = image.naturalHeight || image.height;
        if (!originWidth || !originHeight) return file;

        const resized = getScaledDimensions(originWidth, originHeight, IMAGE_UPLOAD_MAX_LONG_EDGE);
        const needsResize = resized.width !== originWidth || resized.height !== originHeight;
        const needsCompression = file.size > IMAGE_UPLOAD_MIN_COMPRESS_SIZE_BYTES;
        if (!needsResize && !needsCompression) return file;

        const canvas = document.createElement('canvas');
        canvas.width = resized.width;
        canvas.height = resized.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(image, 0, 0, resized.width, resized.height);

        const encodeMime = (
            file.type === 'image/jpeg' ||
            file.type === 'image/png' ||
            file.type === 'image/webp'
        ) ? file.type : 'image/jpeg';

        const blob = await new Promise<Blob | null>((resolve) => {
            const quality = encodeMime === 'image/png' ? undefined : IMAGE_UPLOAD_QUALITY;
            canvas.toBlob(resolve, encodeMime, quality);
        });
        if (!blob) return file;

        if (!needsResize && blob.size >= file.size) return file;

        const extension = blob.type === 'image/jpeg'
            ? '.jpg'
            : (blob.type === 'image/png' ? '.png' : (blob.type === 'image/webp' ? '.webp' : ''));
        const renamed = extension ? buildRenamedFilename(file.name, extension) : file.name;

        return new File([blob], renamed, {
            type: blob.type || encodeMime,
            lastModified: file.lastModified,
        });
    } catch (error) {
        console.warn('[Upload Compression] 이미지 압축 실패, 원본 업로드로 진행합니다.', error);
        return file;
    }
};

const compressFilesForUpload = async (files: File[]): Promise<File[]> => {
    const compressed: File[] = [];
    for (const file of files) {
        compressed.push(await compressImageForUpload(file));
    }
    return compressed;
};

type UploadProcessOptions = {
    uploadMode?: 'single' | 'multi-separate' | 'multi-merged';
    multiFiles?: File[];
};

// Re-export types for backward compatibility
export type { ViewStep, ExtractionStatus, SubDocument, PreviewData, ExtractionModel, ExtractionLog, Highlight };

// Context Value Interface
interface ExtractionContextValue {
    // Model
    model: ExtractionModel | null;
    setModel: (model: ExtractionModel | null) => void;

    // Step Navigation
    activeStep: ViewStep;
    setActiveStep: (step: ViewStep) => void;

    // Status
    status: ExtractionStatus;
    setStatus: (status: ExtractionStatus) => void;

    // File
    file: File | null;
    setFile: (file: File | null) => void;
    candidateFiles: File[] | null;
    setCandidateFiles: (files: File[] | null) => void;
    fileUrl: string | null;
    candidateFileUrls?: string[] | null;
    setCandidateFileUrls: (urls: string[] | null) => void;
    candidateFileUrl: string | null;
    setFileUrl: (url: string | null) => void;
    isDragging: boolean;
    setIsDragging: (dragging: boolean) => void;
    filename: string | null;
    setFilename: (name: string | null) => void;

    // Job & Log tracking
    currentJobId: string | null;
    setCurrentJobId: (id: string | null) => void;
    currentLogId: string | null;
    setCurrentLogId: (id: string | null) => void;

    // Preview Data
    previewData: PreviewData | null;
    setPreviewData: (data: PreviewData | null) => void;

    // Multi-doc
    selectedSubDocIndex: number;
    setSelectedSubDocIndex: (index: number) => void;

    // Extracted Result
    result: Record<string, any> | null;
    setResult: (result: Record<string, any> | null) => void;

    // UI State
    selectedFieldKey: string | null;
    setSelectedFieldKey: (key: string | null) => void;
    error: string | null;
    setError: (error: string | null) => void;

    // Highlights for PDF
    highlights: Highlight[];


    // Actions
    processFile: (file: File, candidateFiles?: File[], options?: UploadProcessOptions) => Promise<void>;
    handleConfirmSelection: (selectedColumns: string[], editedGuideData?: Record<string, any>, editedOtherData?: any[]) => void;
    handleRetry: () => void;
    handleReset: () => void;
    handleCancelPreview: () => void;
    loadFromHistory: (log: ExtractionLog) => void;
    resumeJob: (jobId: string, fileUrl?: string, status?: ExtractionStatus) => void;
    triggerWebhook: () => Promise<any>;
    switchLogVersion: (logId: string) => void;
    isRetrying: boolean;
    isSendingWebhook: boolean;
    uploadProgress: number;
    canEditModel: (targetModelId?: string | null) => boolean;
}

const ExtractionContext = createContext<ExtractionContextValue | null>(null);

export function useExtraction() {
    const context = useContext(ExtractionContext);
    if (!context) {
        throw new Error('useExtraction must be used within ExtractionProvider');
    }
    return context;
}

interface ExtractionProviderProps {
    modelId: string;
    initialModel?: ExtractionModel;
    initialPermissionSummary: ExtractionPermissionSummary;
    children: ReactNode;
}

export function ExtractionProvider({
    modelId,
    initialModel,
    initialPermissionSummary,
    children
}: ExtractionProviderProps) {
    // Model state
    const [model, setModel] = useState<ExtractionModel | null>(initialModel ?? null);

    // Navigation
    const [activeStep, setActiveStep] = useState<ViewStep>('history');

    // Status
    const [status, setStatus] = useState<ExtractionStatus>('idle');

    // File
    const [file, setFile] = useState<File | null>(null);
    const [candidateFiles, setCandidateFiles] = useState<File[] | null>(null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [candidateFileUrls, setCandidateFileUrls] = useState<string[] | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [filename, setFilename] = useState<string | null>(null);

    // State for Job & Log tracking
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [currentLogId, setCurrentLogId] = useState<string | null>(null);

    // State for Preview Data & Results
    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [result, setResult] = useState<Record<string, any> | null>(null);
    const [selectedSubDocIndex, setSelectedSubDocIndex] = useState(0);

    // UI Interactive State
    const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [highlights, setHighlights] = useState<Highlight[]>([]);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [permissionSummary, setPermissionSummary] = useState<ExtractionPermissionSummary>(
        initialPermissionSummary ?? EMPTY_EXTRACTION_PERMISSION_SUMMARY
    );

    // bbox → Highlight[] 변환 로직 (raw 좌표 → PDFViewer에서 정규화)
    useEffect(() => {
        if (!previewData) {
            setHighlights([]);
            return;
        }

        const currentData = previewData.sub_documents && previewData.sub_documents.length > 0
            ? previewData.sub_documents[selectedSubDocIndex]?.data?.guide_extracted
            : previewData.guide_extracted;

        if (!currentData) {
            setHighlights([]);
            return;
        }

        const newHighlights: Highlight[] = [];

        Object.entries(currentData).forEach(([key, item]: [string, any]) => {
            if (!item || typeof item !== 'object') return;

            // [NEW] 멀티 페이지 하이라이트 처리 (Table이 여러 페이지에 걸쳐 있는 경우)
            if (item._table_page_bboxes && typeof item._table_page_bboxes === 'object') {
                const pageBBoxes = item._table_page_bboxes as Record<string, number[] | number[][]>;
                Object.entries(pageBBoxes).forEach(([pNumStr, pBbox]) => {
                    const pNum = Number(pNumStr);
                    const boxes = Array.isArray(pBbox[0]) ? pBbox as number[][] : [pBbox as number[]];
                    boxes.forEach((points) => {
                        if (points.length >= 4) {
                            let x1 = points[0], y1 = points[1], x2 = points[2], y2 = points[3];
                            if (points.length > 4) {
                                const xs = points.filter((_: number, i: number) => i % 2 === 0);
                                const ys = points.filter((_: number, i: number) => i % 2 === 1);
                                x1 = Math.min(...xs); x2 = Math.max(...xs);
                                y1 = Math.min(...ys); y2 = Math.max(...ys);
                            }

                            newHighlights.push({
                                fieldKey: key,
                                content: String(item.source_text || item.value || ''),
                                pageIndex: pNum - 1,
                                position: {
                                    boundingRect: {
                                        x1, y1, x2, y2,
                                        width: x2 - x1,
                                        height: y2 - y1
                                    }
                                }
                            });
                        }
                    });
                });
                return; // 멀티 페이지 처리 완료 후 스킵
            }

            // 일반 단일 페이지 하이라이트 처리
            if (item.bbox) {
                let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
                let polygon: number[] | undefined;
                let validBBox = false;

                if (Array.isArray(item.bbox)) {
                    const points = item.bbox as number[];
                    if (points.length >= 4) {
                        if (points.length === 4) {
                            x1 = points[0]; y1 = points[1]; x2 = points[2]; y2 = points[3];
                        } else {
                            const xs = points.filter((_: number, i: number) => i % 2 === 0);
                            const ys = points.filter((_: number, i: number) => i % 2 === 1);
                            if (xs.length > 0) {
                                x1 = Math.min(...xs); x2 = Math.max(...xs);
                                y1 = Math.min(...ys); y2 = Math.max(...ys);
                                if (points.length === 8) {
                                    polygon = points;
                                }
                            }
                        }
                        validBBox = true;
                    }
                } else if (typeof item.bbox === 'object') {
                    const b = item.bbox as Record<string, number>;
                    x1 = Number(b.x1 ?? b.x ?? 0);
                    y1 = Number(b.y1 ?? b.y ?? 0);
                    x2 = b.x2 !== undefined ? Number(b.x2) : (Number(b.w ?? 0) + x1);
                    y2 = b.y2 !== undefined ? Number(b.y2) : (Number(b.h ?? 0) + y1);
                    if (x2 > x1 || y2 > y1) validBBox = true;
                }

                if (validBBox) {
                    newHighlights.push({
                        fieldKey: key,
                        content: String(item.source_text || item.value || ''),
                        pageIndex: (Number(item.page_number || item.page || 1)) - 1,
                        position: {
                            ...(polygon ? { polygon } : {}),
                            boundingRect: {
                                x1, y1, x2, y2,
                                width: x2 - x1,
                                height: y2 - y1
                            }
                        }
                    });
                }
            }
        });

        setHighlights(newHighlights);
    }, [previewData, selectedSubDocIndex]);


    const queryClient = useQueryClient();

    // Polling Reference
    const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Polling Logic - This will need to be adapted to use Server Actions
    // For now, we'll create a placeholder that can be implemented later
    const startPolling = useCallback((jobId: string) => {
        if (pollingRef.current) clearInterval(pollingRef.current);

        const poll = async () => {
            try {
                // TODO: Implement job status polling via Server Action
                // const job = await getExtractionJob(jobId);
                devLog('[Polling] Job status check for:', jobId);

                // Placeholder - this needs actual implementation
                // For now, we'll just log
            } catch (err) {
                console.error('Polling error:', err);
            }
        };

        poll();
        pollingRef.current = setInterval(poll, POLLING_INTERVAL_MS || 2000);
    }, [model?.fields]);

    // File processing
    const processFile = useCallback(async (selectedFile: File, selectedCandidateFiles?: File[], options?: UploadProcessOptions) => {
        const normalizedSelectedFile = await compressImageForUpload(selectedFile);
        const normalizedCandidateFiles = selectedCandidateFiles
            ? await compressFilesForUpload(selectedCandidateFiles)
            : undefined;
        const normalizedMultiFiles = options?.multiFiles
            ? await compressFilesForUpload(options.multiFiles.filter((candidate) => candidate instanceof File))
            : [];

        setFile(normalizedSelectedFile);
        setCandidateFiles(normalizedCandidateFiles || null);
        setFilename(normalizedSelectedFile.name);

        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }

        setFile(normalizedSelectedFile);
        setCandidateFiles(normalizedCandidateFiles || null);
        setFilename(normalizedSelectedFile.name);
        setStatus(EXTRACTION_STATUS.UPLOADING);
        setError(null);
        setResult(null);
        setUploadProgress(0);
        setCurrentLogId(null);
        setCurrentJobId(null);
        setCandidateFileUrls(null);

        // Helper for XHR-based upload with progress
        const uploadWithProgress = (url: string, file: File, onProgress: (percent: number) => void) => {
            return new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', url, true);
                xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
                xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        onProgress(percentComplete);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Upload failed: ${xhr.statusText}`));
                    }
                };

                xhr.onerror = () => reject(new Error('Network error during upload'));
                xhr.send(file);
            });
        };

        try {
            const isComparisonMode = model?.model_type === 'comparison';
            const requestedMode = options?.uploadMode ?? (
                model?.beta_features?.multifile_strategy === 'merged'
                    ? 'multi-merged'
                    : 'multi-separate'
            );
            const multiFiles = normalizedMultiFiles;
            const isMultifileRun = !isComparisonMode && multiFiles.length > 1 && requestedMode !== 'single';

            if (isMultifileRun) {
                const uploadedFileIds: string[] = [];
                const uploadedUrls: string[] = [];
                const weightPerFile = 100 / multiFiles.length;

                for (let index = 0; index < multiFiles.length; index++) {
                    const targetFile = multiFiles[index];
                    const { sasUrl, fileId } = await generateUploadSasUrl(targetFile.name, 'documents');

                    await uploadWithProgress(sasUrl, targetFile, (percent) => {
                        const baseProgress = index * weightPerFile;
                        const currentProgress = (percent * weightPerFile) / 100;
                        setUploadProgress(baseProgress + currentProgress);
                    });

                    const confirm = await confirmFileUpload(fileId);
                    const removedBlankPages = Array.isArray((confirm as { removed_blank_pages?: unknown }).removed_blank_pages)
                        ? (confirm as { removed_blank_pages: unknown[] }).removed_blank_pages.filter((page): page is number => typeof page === 'number')
                        : [];
                    if (removedBlankPages.length > 0) {
                        toast.info(`빈 페이지 ${removedBlankPages.length}개를 자동 제거했습니다. (${removedBlankPages.join(', ')})`);
                    }
                    uploadedFileIds.push(confirm.fileId);
                    uploadedUrls.push(confirm.url);
                }

                setCandidateFileUrls(uploadedUrls);
                setUploadProgress(100);
                setStatus(EXTRACTION_STATUS.ANALYZING);

                const strategy = requestedMode === 'multi-merged' ? 'merged' : 'separate';
                const extractionResult = await startMultiExtraction(uploadedFileIds, modelId, strategy);

                if (!extractionResult || extractionResult.length === 0) {
                    throw new Error('다중 추출 작업 시작 실패: 서버 응답이 없습니다.');
                }

                toast.success(
                    strategy === 'merged'
                        ? '통합 추출이 시작되었습니다. 추출 기록에서 진행 상황을 확인하실 수 있습니다.'
                        : `${uploadedFileIds.length}건의 개별 추출이 시작되었습니다. 추출 기록에서 진행 상황을 확인하실 수 있습니다.`
                );
                queryClient.invalidateQueries({ queryKey: ['extraction-logs', modelId] });
                setActiveStep('history');
                setStatus('idle');
                setCurrentLogId(null);
                return;
            }

            // 1. Upload baseline file
            setStatus(EXTRACTION_STATUS.UPLOADING);
            const { sasUrl: baselineSas, fileId: baselineId } = await generateUploadSasUrl(
                normalizedSelectedFile.name,
                'documents'
            );

            const hasCandidates = normalizedCandidateFiles && normalizedCandidateFiles.length > 0;

            // Initial progress weighting: baseline=50%, candidates=50% if present, else baseline=100%
            const baselineWeight = hasCandidates ? 50 : 100;

            await uploadWithProgress(baselineSas, normalizedSelectedFile, (percent) => {
                setUploadProgress((percent * baselineWeight) / 100);
            });

            const baselineConfirm = await confirmFileUpload(baselineId);
            const baselineRemovedBlankPages = Array.isArray((baselineConfirm as { removed_blank_pages?: unknown }).removed_blank_pages)
                ? (baselineConfirm as { removed_blank_pages: unknown[] }).removed_blank_pages.filter((page): page is number => typeof page === 'number')
                : [];
            if (baselineRemovedBlankPages.length > 0) {
                toast.info(`기준 문서에서 빈 페이지 ${baselineRemovedBlankPages.length}개를 자동 제거했습니다. (${baselineRemovedBlankPages.join(', ')})`);
            }
            setFileUrl(baselineConfirm.url);

            // 2. Upload candidate files (if any)
            const candidateIds: string[] = [];
            const candidateUrls: string[] = [];

            if (hasCandidates && normalizedCandidateFiles) {
                devLog('[Process] Uploading', normalizedCandidateFiles.length, 'candidate files');
                const perCandidateWeight = 50 / normalizedCandidateFiles.length;

                for (let i = 0; i < normalizedCandidateFiles.length; i++) {
                    const candidateFile = normalizedCandidateFiles[i];
                    const { sasUrl, fileId } = await generateUploadSasUrl(candidateFile.name, 'documents');

                    await uploadWithProgress(sasUrl, candidateFile, (percent) => {
                        const baseProgress = 50 + (i * perCandidateWeight);
                        const currentCandidateProgress = (percent * perCandidateWeight) / 100;
                        setUploadProgress(baseProgress + currentCandidateProgress);
                    });

                    const confirm = await confirmFileUpload(fileId);
                    const removedBlankPages = Array.isArray((confirm as { removed_blank_pages?: unknown }).removed_blank_pages)
                        ? (confirm as { removed_blank_pages: unknown[] }).removed_blank_pages.filter((page): page is number => typeof page === 'number')
                        : [];
                    if (removedBlankPages.length > 0) {
                        toast.info(`후보 문서에서 빈 페이지 ${removedBlankPages.length}개를 자동 제거했습니다. (${removedBlankPages.join(', ')})`);
                    }
                    candidateIds.push(fileId);
                    candidateUrls.push(confirm.url);
                }
                setCandidateFileUrls(candidateUrls);
            }

            setUploadProgress(100);

            // 3. Start extraction (passing candidate IDs)
            // Transit to ANALYZING status before calling the server action
            setStatus(EXTRACTION_STATUS.ANALYZING);

            const extractionResult = await startExtraction(
                baselineConfirm.fileId,
                modelId,
                candidateIds.length > 0 ? candidateIds : undefined
            );

            if (extractionResult) {
                // 분석 시작 알림
                toast.success('분석이 시작되었습니다. 추출 기록에서 진행 상황을 확인하실 수 있습니다.');

                // 목록 갱신 강제하여 새 항목이 바로 보이게 함
                queryClient.invalidateQueries({ queryKey: ['extraction-logs', modelId] });

                // 상태 초기화 및 기록 탭으로 이동
                setActiveStep('history');
                setStatus('idle');
                setCurrentLogId(null); // URL 동기화 방지를 위해 null 유지
            } else {
                throw new Error('추출 작업 시작 실패: 서버 응답이 없습니다.');
            }
        } catch (e: unknown) {
            console.error('[processFile] Error:', e);
            const errorMessage = e instanceof Error ? e.message : '추출 요청 중 오류가 발생했습니다.';
            setStatus(EXTRACTION_STATUS.ERROR);
            setError(errorMessage);
            toast.error(errorMessage);
        }
    }, [
        model?.beta_features?.multifile_strategy,
        model?.model_type,
        modelId,
        startPolling,
        queryClient,
        setCurrentLogId,
        setActiveStep,
        setStatus,
        setError
    ]);

    const confirmJobMutation = useMutation({
        mutationFn: async ({ editedGuideData, editedOtherData }: { editedGuideData?: Record<string, any>, editedOtherData?: any[] }) => {
            const activeSubDoc = model?.is_super_model ? previewData?.sub_documents?.[selectedSubDocIndex] : null;
            const targetLogId = activeSubDoc?.id || currentLogId?.replace('group_', '') || '';
            const targetModelId = activeSubDoc?.model_id || modelId;

            const result = await updateExtractionData(
                targetLogId,
                targetModelId,
                editedGuideData || {},
                editedOtherData || [],
                model?.is_super_model ? selectedSubDocIndex : undefined
            );

            if (!result.ok) {
                const error = new Error(result.error.message);
                (error as any).detail = result.error.detail;
                (error as any).errorId = result.error.errorId;
                (error as any).code = result.error.code;
                (error as any).requestSizeBytes = result.error.requestSizeBytes;
                throw error;
            }

            return result.data;
        },
        onSuccess: (data) => {
            devLog('[Save] Saved successfully');
            toast.success('저장되었습니다.');

            // Invalidate queries to refresh history and grouped views
            queryClient.invalidateQueries({ queryKey: ['extraction-logs', modelId] });

            // Update local state to reflect changes immediately in UI
            if (data?.extracted_data) setResult(data.extracted_data);

            if (model?.is_super_model && previewData?.sub_documents) {
                const updatedSubDocs = [...previewData.sub_documents];
                if (updatedSubDocs[selectedSubDocIndex]) {
                    updatedSubDocs[selectedSubDocIndex] = {
                        ...updatedSubDocs[selectedSubDocIndex],
                        data: {
                            guide_extracted: data?.preview_data?.guide_extracted || data?.extracted_data || {},
                            other_data: data?.preview_data?.other_data || updatedSubDocs[selectedSubDocIndex].data?.other_data || []
                        }
                    };
                    setPreviewData({
                        ...previewData,
                        sub_documents: updatedSubDocs
                    });
                }
            } else if (!model?.is_super_model && data?.preview_data) {
                setPreviewData({
                    ...data.preview_data,
                    model_fields: data.preview_data.model_fields || model?.fields?.map(f => ({ key: f.key, label: f.label })) || []
                });
            }
        },
        onError: (err: any) => {
            const summary = err?.message || '알 수 없는 오류';
            const detail = err?.detail ? ` / ${err.detail}` : '';
            const trace = err?.errorId ? ` [ErrorID: ${err.errorId}]` : '';
            toast.error(`저장 실패: ${summary}${detail}${trace}`);
        }
    });

    const handleConfirmSelection = useCallback((
        _selectedColumns: string[],
        editedGuideData?: Record<string, any>,
        editedOtherData?: any[]
    ) => {
        if (!currentLogId) {
            devLog('[Save] Skipped - no log ID');
            return;
        }

        confirmJobMutation.mutate({ editedGuideData, editedOtherData });
    }, [currentLogId, confirmJobMutation]);

    const retryMutation = useMutation({
        mutationFn: async () => {
            const activeSubDoc = model?.is_super_model ? previewData?.sub_documents?.[selectedSubDocIndex] : null;
            const targetLogId = activeSubDoc?.id || currentLogId?.replace('group_', '') || '';
            const targetModelId = activeSubDoc?.model_id || modelId;

            if (!targetLogId) throw new Error('No log to retry');
            setStatus(EXTRACTION_STATUS.ANALYZING);
            return await retryExtraction(targetLogId, targetModelId);
        },
        onSuccess: (newLog: any) => {
            if (newLog) {
                devLog('[Retry] Log created, redirecting to history...', newLog.id);

                // 1. 목록 갱신 강제
                queryClient.invalidateQueries({ queryKey: ['extraction-logs', modelId] });

                // 2. 상태 초기화 및 기록 탭으로 이동 (파일 업로드와 동일한 흐름)
                setActiveStep('history');
                setStatus('idle');
                setCurrentLogId(null);

                // 3. 알림
                toast.success('재추출이 시작되었습니다. 추출 기록 목록에서 확인 가능합니다.');
            }
        },
        onError: (error: any) => {
            toast.error(`재시도 실패: ${error?.message || '알 수 없는 오류'}`);
            setStatus(EXTRACTION_STATUS.ERROR);
        }
    });

    const webhookMutation = useMutation({
        mutationFn: async () => {
            const activeSubDoc = model?.is_super_model ? previewData?.sub_documents?.[selectedSubDocIndex] : null;
            const targetLogId = activeSubDoc?.id || currentLogId?.replace('group_', '') || '';
            const targetModelId = activeSubDoc?.model_id || modelId;
            const currentSubDocLogIds = model?.is_super_model
                ? (previewData?.sub_documents || [])
                    .map((subDoc) => subDoc.id)
                    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                : undefined;

            if (!targetLogId) throw new Error('No log selected');
            return await triggerExtractionWebhook(targetLogId, targetModelId, { currentSubDocLogIds });
        },
        onSuccess: () => {
            toast.success('Webhook이 성공적으로 전달되었습니다.');
        },
        onError: (error: any) => {
            toast.error(`Webhook 전달 실패: ${error?.message || '알 수 없는 오류'}`);
        }
    });

    const handleRetry = useCallback(() => {
        if (currentLogId) {
            retryMutation.mutate();
        } else if (file) {
            processFile(file);
        } else {
            toast.error('재시도할 수 없습니다. 목록에서 다시 선택해 주세요.');
        }
    }, [currentLogId, file, retryMutation, processFile]);

    const handleReset = useCallback(() => {
        setFile(null);
        setCandidateFiles(null);
        setCandidateFileUrls(null);
        setFileUrl(null);
        setPreviewData(null);
        setResult(null);
        setStatus('idle');
        setCurrentJobId(null);
        setCurrentLogId(null);
        setSelectedSubDocIndex(0);
        setActiveStep('upload');
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    const handleCancelPreview = useCallback(() => {
        handleReset();
        setActiveStep('history');
    }, [handleReset]);

    const switchLogVersion = useCallback((logId: string) => {
        setPreviewData(prev => {
            if (!prev || !prev.sub_documents) return prev;

            let targetLog: any = null;
            for (const sd of prev.sub_documents) {
                if (sd.history) {
                    const found = sd.history.find((l: any) => l.id === logId);
                    if (found) {
                        targetLog = found;
                        break;
                    }
                }
            }
            if (!targetLog) return prev;

            const newSubDocs = [...prev.sub_documents];
            const sdIndex = newSubDocs.findIndex(sd => sd.model_id === targetLog.model_id);
            if (sdIndex > -1) {
                newSubDocs[sdIndex] = {
                    ...newSubDocs[sdIndex],
                    id: targetLog.id,
                    filename: targetLog.filename,
                    data: {
                        guide_extracted: targetLog.preview_data?.guide_extracted || targetLog.extracted_data || {},
                        other_data: targetLog.preview_data?.other_data || []
                    },
                    file: {
                        filename: targetLog.filename,
                        blob_path: targetLog.metadata?.blob_path || targetLog.file_url || '',
                    },
                    raw_content: (targetLog.preview_data as any)?.raw_content || '',
                    status: isSuccessStatus(targetLog.status) ? 'success' : 'error' as any
                };
            }
            return { ...prev, sub_documents: newSubDocs };
        });
    }, []);

    const resumeJob = useCallback((jobId: string, url?: string, jobStatus?: ExtractionStatus) => {
        devLog('[resumeJob] Resuming job:', jobId);
        setCurrentJobId(jobId);
        if (url) setFileUrl(url);

        if (jobStatus === EXTRACTION_STATUS.PREVIEW_READY) {
            startPolling(jobId);
            setStatus(EXTRACTION_STATUS.REFINING);
        } else {
            setStatus(EXTRACTION_STATUS.REFINING);
            startPolling(jobId);
        }

        setActiveStep('upload');
    }, [startPolling]);

    const loadFromHistory = useCallback((log: ExtractionLog) => {
        if (!log) return;
        // devLog('[loadFromHistory] Loading log:', { id: log.id, file_url: log.file_url, filename: log.filename });

        // 상태 초기화
        setSelectedSubDocIndex(0);
        setSelectedFieldKey(null);
        setHighlights([]);

        // 1. 하위 로그(Super Model) 처리
        // 동일한 모델 ID를 가진 로그들을 그룹화하여 가장 최신(또는 성공한 것)을 대표로 표시합니다.
        let subDocs = log.preview_data?.sub_documents || [];
        if (log.is_grouped && log.logs && log.logs.length > 0) {
            const groups: Record<string, ExtractionLog[]> = {};
            log.logs.forEach(l => {
                const mid = l.model_id;
                if (!groups[mid]) groups[mid] = [];
                groups[mid].push(l);
            });

            subDocs = Object.keys(groups).map((mid, idx) => {
                const groupLogs = groups[mid];
                // 성공한 것 중 최신, 없으면 그냥 최신 (현재 logs는 이미 getExtractionLog에서 최신순으로 정렬되어 있음)
                const latestSuccess = groupLogs.find(l => isSuccessStatus(l.status)) || groupLogs[0];

                return {
                    id: latestSuccess.id,
                    model_id: latestSuccess.model_id,
                    index: idx,
                    type: latestSuccess.metadata?.type || 'Other',
                    filename: latestSuccess.filename,
                    data: {
                        guide_extracted: latestSuccess.preview_data?.guide_extracted || latestSuccess.extracted_data || {},
                        other_data: latestSuccess.preview_data?.other_data || []
                    },
                    file: {
                        filename: latestSuccess.filename,
                        blob_path: latestSuccess.metadata?.blob_path || latestSuccess.file_url || '',
                    },
                    raw_content: (latestSuccess.preview_data as any)?.raw_content || '',
                    status: isSuccessStatus(latestSuccess.status) ? 'success' : 'error' as any,
                    history: groupLogs
                };
            });
        }

        // Prefer rich data from preview_data for UI (confidence, bbox, etc.)
        const richData = log.preview_data?.guide_extracted || log.extracted_data || null;
        setResult(richData);
        setStatus(isSuccessStatus(log.status) ? EXTRACTION_STATUS.COMPLETE : EXTRACTION_STATUS.ERROR);
        setFileUrl(log.file_url || null);
        setFile(null);
        setFilename(log.file?.filename || log.filename);
        setCurrentLogId(log.id);

        if (log.preview_data) {
            const previewComp = (log.preview_data as any).comparisons;
            const richComp = (richData as any)?.comparisons;

            setPreviewData({
                ...log.preview_data,
                sub_documents: subDocs,
                comparisons: previewComp || richComp,
                mode: (log.preview_data as any).mode || (model?.model_type === 'comparison' ? 'comparison' : 'extraction'),
                debug_data: log.debug_data,
                model_fields: log.preview_data.model_fields || model?.fields?.map(f => ({ key: f.key, label: f.label })) || []
            });
        } else {
            setPreviewData({
                sub_documents: subDocs,
                guide_extracted: log.extracted_data || {},
                comparisons: (log.extracted_data as any)?.comparisons,
                mode: model?.model_type === 'comparison' ? 'comparison' : 'extraction',
                other_data: [],
                model_fields: model?.fields?.map(f => ({ key: f.key, label: f.label })) || []
            });
        }

        setActiveStep('complete');
    }, [model?.fields, model?.model_type]);

    useEffect(() => {
        setModel(initialModel ?? null);
    }, [initialModel]);

    // Load model data
    useEffect(() => {
        if (!modelId) return;
        if (initialModel?.id === modelId) return;

        getExtractionModel(modelId)
            .then(modelData => {
                if (modelData) {
                    setModel(modelData as any);
                }
            })
            .catch(err => {
                console.error('Failed to load model:', err);
                toast.error('모델 정보를 불러올 수 없습니다');
            });
    }, [initialModel?.id, modelId]);

    useEffect(() => {
        setPermissionSummary(initialPermissionSummary ?? EMPTY_EXTRACTION_PERMISSION_SUMMARY);
    }, [initialPermissionSummary]);

    useEffect(() => {
        let cancelled = false;

        getExtractionPermissionSummary()
            .then((summary) => {
                if (cancelled) return;
                setPermissionSummary(summary);
                devLog('[ExtractionProvider] permission summary loaded', {
                    providerModelId: modelId,
                    isGlobalAdmin: summary.isGlobalAdmin,
                    roleCount: summary.roles.length,
                });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('Failed to refresh permission summary:', err);
            });

        return () => {
            cancelled = true;
        };
    }, [modelId]);

    const canEditModel = useCallback((targetModelId?: string | null) => {
        return canEditExtractionModel(permissionSummary, targetModelId);
    }, [permissionSummary]);

    const value: ExtractionContextValue = useMemo(() => ({
        model, setModel,
        activeStep, setActiveStep,
        status, setStatus,
        file, setFile,
        candidateFiles, setCandidateFiles,
        fileUrl, setFileUrl,
        candidateFileUrls, setCandidateFileUrls,
        candidateFileUrl: candidateFileUrls?.[0] || null,
        filename, setFilename,
        isDragging, setIsDragging,
        currentJobId, setCurrentJobId,
        currentLogId, setCurrentLogId,
        previewData, setPreviewData,
        selectedSubDocIndex, setSelectedSubDocIndex,
        result, setResult,
        selectedFieldKey, setSelectedFieldKey,
        error, setError,
        highlights,
        processFile,
        handleConfirmSelection,
        handleRetry,
        handleReset,
        handleCancelPreview,
        loadFromHistory,
        resumeJob,
        triggerWebhook: webhookMutation.mutateAsync,
        switchLogVersion,
        isRetrying: retryMutation.isPending,
        isSendingWebhook: webhookMutation.isPending,
        uploadProgress,
        canEditModel
    }), [
        model, activeStep, status, file, candidateFiles, fileUrl, candidateFileUrls, filename, isDragging,
        currentJobId, currentLogId, previewData, selectedSubDocIndex,
        result, selectedFieldKey, error, highlights,
        processFile, handleConfirmSelection, handleRetry, handleReset,
        handleCancelPreview, loadFromHistory, resumeJob, webhookMutation.mutateAsync,
        switchLogVersion, retryMutation.isPending, webhookMutation.isPending, uploadProgress, canEditModel
    ]);

    return (
        <ExtractionContext.Provider value={value}>
            {children}
        </ExtractionContext.Provider>
    );
}
