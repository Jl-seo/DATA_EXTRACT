'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExtractionProvider, useExtraction } from './context/ExtractionContext';
import { ExtractionWizardHeader } from './ExtractionWizardHeader';
import { ExtractionHistoryView } from './ExtractionHistoryView';
import { ExtractionUploadView } from './ExtractionUploadView';
import { ExtractionReviewView } from './ExtractionReviewView';
import { ComparisonReviewView } from './ComparisonReviewView';
import type { ExtractionLog } from './types';
import { getExtractionLog } from '@/actions/extractionLog';
import { canTriggerExtractionWebhook } from '@/actions/extraction';
import type { ExtractionPermissionSummary } from '@/lib/extractionPermission';

interface DocumentExtractionViewProps {
    modelId: string;
    initialLogId?: string;
    initialModel?: import('./types').ExtractionModel;
    initialLog?: ExtractionLog;
    initialPermissionSummary: ExtractionPermissionSummary;
}

type UploadEntryMode = 'single' | 'multi';

function ExtractionContainer({
    initialLogId,
    initialLog,
}: {
    modelId: string;
    initialLogId?: string;
    initialLog?: ExtractionLog;
}) {
    const {
        model,
        activeStep,
        setActiveStep,
        status,
        file,
        fileUrl,
        filename,
        previewData,
        result,
        selectedSubDocIndex,
        setSelectedSubDocIndex,
        selectedFieldKey,
        setSelectedFieldKey,
        highlights,
        processFile,
        handleConfirmSelection,
        handleRetry,
        handleReset,
        handleCancelPreview,
        currentLogId,
        loadFromHistory,
        triggerWebhook,
        switchLogVersion,
        isRetrying,
        isSendingWebhook,
        canEditModel
    } = useExtraction();

    const router = useRouter();
    const pathname = usePathname();
    const [uploadEntryMode, setUploadEntryMode] = useState<UploadEntryMode>('single');
    const activeSubDoc = model?.is_super_model ? previewData?.sub_documents?.[selectedSubDocIndex] : null;
    const webhookTargetLogId = activeSubDoc?.id || currentLogId?.replace('group_', '') || '';
    const webhookTargetModelId = activeSubDoc?.model_id || model?.id || '';
    const webhookAvailabilityQuery = useQuery({
        queryKey: ['webhook-availability', webhookTargetLogId, webhookTargetModelId],
        queryFn: async () => {
            return await canTriggerExtractionWebhook(webhookTargetLogId, webhookTargetModelId);
        },
        enabled: !!webhookTargetLogId && !!webhookTargetModelId && (activeStep === 'review' || activeStep === 'complete'),
        staleTime: 30_000,
    });

    // ---------------------------------------------------------------------------
    // Sync currentLogId to URL
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlLogId = params.get('logId');

        if (currentLogId) {
            if (urlLogId !== currentLogId) {
                params.set('logId', currentLogId);
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }
        } else if (urlLogId) {
            // Only clear if we are in history or upload step intentionaly
            if (activeStep === 'history' || activeStep === 'upload') {
                params.delete('logId');
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }
        }
    }, [currentLogId, activeStep, pathname, router]);

    // ---------------------------------------------------------------------------
    // Handle Initial Log URL Mapping
    // ---------------------------------------------------------------------------
    const initialLogProcessedRef = useRef(false);

    useEffect(() => {
        if (!initialLogId || !model || initialLogProcessedRef.current) return;

        initialLogProcessedRef.current = true;

        const loadLog = async () => {
            try {
                if (initialLog) {
                    loadFromHistory(initialLog);
                    return;
                }

                // Wait briefly if context is still booting up (though model is loaded)
                const log = await getExtractionLog(initialLogId);
                if (log) {
                    loadFromHistory(log as unknown as ExtractionLog);
                } else {
                    toast.error('추출 기록을 찾을 수 없습니다.');
                    setActiveStep('history');
                }
            } catch (error) {
                console.error('Failed to load initial log:', error);
                toast.error('추출 기록을 불러오는 중 오류가 발생했습니다.');
                setActiveStep('history');
            }
        };

        loadLog();
    }, [initialLog, initialLogId, model, loadFromHistory, setActiveStep]);
    // ---------------------------------------------------------------------------

    if (!model) {
        return (
            <div className="flex-1 flex items-center justify-center bg-muted h-full">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">모델 정보 로딩 중...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background relative overflow-hidden">
            {/* Header (Wizard Steps) - Shows only during extraction flow */}
            {activeStep !== 'history' && (
                <ExtractionWizardHeader
                    activeStep={activeStep}
                    modelName={model.name}
                    onStepChange={setActiveStep}
                    onCancel={handleCancelPreview}
                />
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative flex flex-col min-w-0">
                {/* 1. History View (Default Dashboard) */}
                {activeStep === 'history' && (
                    <ExtractionHistoryView
                        model={model}
                        onNewExtraction={(mode) => {
                            setUploadEntryMode(mode);
                            setActiveStep('upload');
                        }}
                        onSelectHistory={(log) => loadFromHistory(log)}
                    />
                )}

                {/* 2. Upload / Processing View */}
                {activeStep === 'upload' && (
                    <ExtractionUploadView
                        file={file}
                        status={status}
                        model={model}
                        forcedUploadMode={uploadEntryMode}
                        onFileSelect={processFile}
                        onCancel={() => {
                            handleReset();
                            setActiveStep('history');
                        }}
                    />
                )}

                {(activeStep === 'review' || activeStep === 'complete') && (
                    model.model_type === 'comparison' ? (
                        <ComparisonReviewView
                            previewData={previewData}
                            model={model}
                            baselineUrl={fileUrl || null}
                            onRetry={handleRetry}
                            onReset={handleReset}
                        />
                    ) : (
                        <ExtractionReviewView
                            previewData={previewData}
                            result={result}
                            model={model}
                            highlights={highlights}
                            selectedSubDocIndex={selectedSubDocIndex}
                            selectedFieldKey={selectedFieldKey}
                            file={file}
                            fileUrl={fileUrl || null}
                            filename={filename}
                            isProcessing={isRetrying}
                            isSendingWebhook={isSendingWebhook}
                            onSubDocSelect={setSelectedSubDocIndex}
                            onFieldSelect={setSelectedFieldKey}
                            onRetry={handleRetry}
                            onSave={(guide, other) => {
                                handleConfirmSelection([], guide, other);
                            }}
                            onSendWebhook={() => {
                                triggerWebhook();
                            }}
                            onVersionSwitch={switchLogVersion}
                            canEditModel={canEditModel}
                            canSendWebhook={webhookAvailabilityQuery.data?.canTrigger === true}
                        />
                    )
                )}

            </div>
        </div>
    );
}

/**
 * Main Entry Point
 * Wraps the container with the ExtractionProvider
 */
export function DocumentExtractionView(props: DocumentExtractionViewProps) {
    return (
        <ExtractionProvider
            modelId={props.modelId}
            initialModel={props.initialModel}
            initialPermissionSummary={props.initialPermissionSummary}
        >
            <ExtractionContainer {...props} />
        </ExtractionProvider>
    );
}
