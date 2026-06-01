'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Barcode, Camera, Loader2, RefreshCcw, SearchCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { Html5Qrcode, Html5QrcodeResult } from 'html5-qrcode';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { sleep } from '@/utils/sleep';
import { buildCameraConstraintsCandidates } from './cameraConstraints';
import {
    type BarcodeErpLookup,
    type BarcodeScanMode,
    type ScannedBarcode,
    buildMockErpLookups,
    mergeScannedBarcode,
} from './barcodeMock';

type CameraStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error';

interface BarcodeScannerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultScanMode: BarcodeScanMode;
}

const SCANNER_ELEMENT_ID = 'barcode-scanner-region';
const DUPLICATED_READ_GUARD_MS = 1200;

const formatScanTime = (iso: string): string => {
    return new Date(iso).toLocaleString('ko-KR', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

export function BarcodeScannerDialog({ open, onOpenChange, defaultScanMode }: BarcodeScannerDialogProps) {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const duplicateGuardRef = useRef<Record<string, number>>({});

    const [scanMode, setScanMode] = useState<BarcodeScanMode>(defaultScanMode);
    const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [scannerVersion, setScannerVersion] = useState(0);
    const [isLookupLoading, setIsLookupLoading] = useState(false);
    const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>([]);
    const [lookupRows, setLookupRows] = useState<Record<string, BarcodeErpLookup>>({});

    const stopScanner = useCallback(async () => {
        const scanner = scannerRef.current;
        if (!scanner) {
            return;
        }

        try {
            if (scanner.isScanning) {
                await scanner.stop();
            }
        } catch (error) {
            console.error('[BarcodeScannerDialog] scanner stop failed:', error);
        }

        try {
            scanner.clear();
        } catch (error) {
            console.error('[BarcodeScannerDialog] scanner clear failed:', error);
        }

        scannerRef.current = null;
    }, []);

    const handleLookup = useCallback(async (targetCodes?: string[]) => {
        const requestedCodes = targetCodes && targetCodes.length > 0
            ? targetCodes
            : scannedBarcodes.map((row) => row.code);

        if (requestedCodes.length === 0) {
            toast.error('조회할 바코드가 없습니다.');
            return;
        }

        setIsLookupLoading(true);
        try {
            await sleep(450);
            const records = buildMockErpLookups(requestedCodes);
            setLookupRows((previous) => {
                const next = { ...previous };
                records.forEach((record) => {
                    next[record.barcode] = record;
                });
                return next;
            });
            toast.success('기간계 조회(Mock) 결과를 반영했습니다.');
        } finally {
            setIsLookupLoading(false);
        }
    }, [scannedBarcodes]);

    const handleScannerRefresh = useCallback(() => {
        duplicateGuardRef.current = {};
        setLookupRows({});
        setScannedBarcodes([]);
        setCameraError(null);
        setScannerVersion((prev) => prev + 1);
        toast.success('바코드 스캐너를 초기화했습니다.');
    }, []);

    useEffect(() => {
        setScanMode(defaultScanMode);
    }, [defaultScanMode]);

    useEffect(() => {
        if (!open) {
            setCameraStatus('idle');
            setCameraError(null);
            duplicateGuardRef.current = {};
            void stopScanner();
            return;
        }

        let cancelled = false;

        const startScanner = async () => {
            setCameraStatus('starting');
            setCameraError(null);

            try {
                const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
                if (cancelled) {
                    return;
                }

                const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
                    verbose: false,
                    formatsToSupport: [
                        Html5QrcodeSupportedFormats.CODE_128,
                        Html5QrcodeSupportedFormats.CODE_39,
                        Html5QrcodeSupportedFormats.EAN_13,
                        Html5QrcodeSupportedFormats.EAN_8,
                        Html5QrcodeSupportedFormats.ITF,
                        Html5QrcodeSupportedFormats.UPC_A,
                        Html5QrcodeSupportedFormats.UPC_E,
                        Html5QrcodeSupportedFormats.QR_CODE,
                    ],
                });

                scannerRef.current = scanner;
                const scanModeAtStart = scanMode;

                const onScanSuccess = (decodedText: string, result: Html5QrcodeResult) => {
                    const code = decodedText.trim();
                    if (!code) {
                        return;
                    }

                    const now = Date.now();
                    const previousScannedAt = duplicateGuardRef.current[code] ?? 0;
                    if (now - previousScannedAt < DUPLICATED_READ_GUARD_MS) {
                        return;
                    }
                    duplicateGuardRef.current[code] = now;

                    const format = result.result.format?.formatName ?? 'UNKNOWN';
                    const scannedAt = new Date().toISOString();

                    setScannedBarcodes((previous) => mergeScannedBarcode(
                        previous,
                        { code, format, scannedAt },
                        scanModeAtStart
                    ));

                    if (scanModeAtStart === 'single') {
                        setCameraStatus('paused');
                        void stopScanner();
                    }
                };

                const scanConfiguration = {
                    fps: 10,
                    qrbox: { width: 320, height: 140 },
                };

                const candidates = buildCameraConstraintsCandidates('environment');
                let lastStartError: unknown = null;
                for (const candidate of candidates) {
                    try {
                        await scanner.start(
                            candidate,
                            scanConfiguration,
                            onScanSuccess,
                            () => {
                                // 스캔 실패 로그는 매우 빈번하게 발생하므로 UI 알림을 노출하지 않는다.
                            }
                        );
                        lastStartError = null;
                        break;
                    } catch (error) {
                        lastStartError = error;
                    }
                }

                if (lastStartError) {
                    throw lastStartError;
                }

                if (!cancelled) {
                    setCameraStatus('running');
                }
            } catch (error) {
                console.error('[BarcodeScannerDialog] scanner start failed:', error);
                if (cancelled) {
                    return;
                }
                setCameraStatus('error');
                setCameraError('카메라를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.');
            }
        };

        void startScanner();

        return () => {
            cancelled = true;
            void stopScanner();
        };
    }, [open, scanMode, scannerVersion, stopScanner]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(1120px,calc(100vw-2rem))] max-w-none sm:max-w-[1120px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Barcode className="h-5 w-5 text-primary" />
                        바코드 스캔
                    </DialogTitle>
                    <DialogDescription>
                        모델 설정에서 활성화한 경우에만 사용할 수 있습니다. 단일/멀티 스캔 후 기간계 조회는 Mock 데이터로 제공합니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant={scanMode === 'single' ? 'default' : 'outline'}
                            onClick={() => setScanMode('single')}
                        >
                            단일 인식
                        </Button>
                        <Button
                            type="button"
                            variant={scanMode === 'multi' ? 'default' : 'outline'}
                            onClick={() => setScanMode('multi')}
                        >
                            멀티 인식
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleScannerRefresh}
                        >
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            결과 초기화
                        </Button>

                        <div className="ml-auto flex items-center gap-2">
                            <Badge variant={cameraStatus === 'running' ? 'default' : 'secondary'}>
                                <Camera className="mr-1 h-3 w-3" />
                                {cameraStatus === 'starting' && '카메라 시작 중'}
                                {cameraStatus === 'running' && '카메라 실행 중'}
                                {cameraStatus === 'paused' && '단일 스캔 완료'}
                                {cameraStatus === 'error' && '카메라 오류'}
                                {cameraStatus === 'idle' && '대기'}
                            </Badge>
                            <Badge variant="outline">스캔 {scannedBarcodes.length}건</Badge>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-lg border bg-black/90">
                            <div id={SCANNER_ELEMENT_ID} className="min-h-[280px] w-full" />
                            {cameraError && (
                                <div className="border-t border-border/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                    {cameraError}
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border bg-card p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold">스캔 결과</p>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                        void handleLookup();
                                    }}
                                    disabled={isLookupLoading || scannedBarcodes.length === 0}
                                >
                                    {isLookupLoading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <SearchCheck className="mr-2 h-4 w-4" />
                                    )}
                                    기간계 조회(Mock)
                                </Button>
                            </div>

                            <div className="max-h-[340px] overflow-auto rounded border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[130px]">형식</TableHead>
                                            <TableHead>바코드</TableHead>
                                            <TableHead className="w-[74px] text-right">횟수</TableHead>
                                            <TableHead className="w-[180px]">조회 상태</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {scannedBarcodes.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                                                    아직 인식된 바코드가 없습니다.
                                                </TableCell>
                                            </TableRow>
                                        )}

                                        {scannedBarcodes.map((row) => {
                                            const lookup = lookupRows[row.code];
                                            return (
                                                <TableRow key={row.code}>
                                                    <TableCell className="text-xs">{row.format}</TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="font-mono text-xs">{row.code}</span>
                                                            <span className="text-[10px] text-muted-foreground">{formatScanTime(row.scannedAt)}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right text-xs">{row.hitCount}</TableCell>
                                                    <TableCell>
                                                        {lookup ? (
                                                            <div className="space-y-1 text-[11px]">
                                                                <div className="font-medium">
                                                                    {lookup.itemName} ({lookup.itemCode})
                                                                </div>
                                                                <div className="text-muted-foreground">
                                                                    {lookup.warehouse} / {lookup.quantity} / {lookup.status}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    void handleLookup([row.code]);
                                                                }}
                                                                disabled={isLookupLoading}
                                                            >
                                                                개별 조회(Mock)
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
