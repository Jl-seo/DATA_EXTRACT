import dayjs from 'dayjs';
import { z } from 'zod';

export const BarcodeScanModeSchema = z.enum(['single', 'multi']);
export type BarcodeScanMode = z.infer<typeof BarcodeScanModeSchema>;

export const ScannedBarcodeInputSchema = z.object({
    code: z.string().trim().min(1, '바코드 값이 비어 있습니다.'),
    format: z.string().trim().min(1, '바코드 형식이 비어 있습니다.'),
    scannedAt: z.string().trim().min(1, '스캔 시간이 비어 있습니다.'),
});
export type ScannedBarcodeInput = z.infer<typeof ScannedBarcodeInputSchema>;

export const ScannedBarcodeSchema = ScannedBarcodeInputSchema.extend({
    hitCount: z.number().int().min(1),
});
export type ScannedBarcode = z.infer<typeof ScannedBarcodeSchema>;

export const BarcodeErpLookupSchema = z.object({
    barcode: z.string().trim().min(1),
    itemCode: z.string().trim().min(1),
    itemName: z.string().trim().min(1),
    lotNo: z.string().trim().min(1),
    warehouse: z.string().trim().min(1),
    quantity: z.number().int().nonnegative(),
    inspectedAt: z.string().trim().min(1),
    status: z.enum(['정상', '검증필요']),
});
export type BarcodeErpLookup = z.infer<typeof BarcodeErpLookupSchema>;

const WAREHOUSE_OPTIONS = ['인천', '평택', '부산', '광양'] as const;
const STATUS_OPTIONS = ['정상', '검증필요'] as const;

const createDeterministicSeed = (barcode: string): number => {
    let sum = 0;
    for (let index = 0; index < barcode.length; index += 1) {
        sum += barcode.charCodeAt(index) * (index + 1);
    }
    return sum;
};

export const mergeScannedBarcode = (
    previous: ScannedBarcode[],
    incoming: ScannedBarcodeInput,
    mode: BarcodeScanMode
): ScannedBarcode[] => {
    const parsedPrevious = z.array(ScannedBarcodeSchema).parse(previous);
    const parsedIncoming = ScannedBarcodeInputSchema.parse(incoming);
    const parsedMode = BarcodeScanModeSchema.parse(mode);

    if (parsedMode === 'single') {
        return [{ ...parsedIncoming, hitCount: 1 }];
    }

    const existingIndex = parsedPrevious.findIndex((entry) => entry.code === parsedIncoming.code);
    if (existingIndex < 0) {
        return [...parsedPrevious, { ...parsedIncoming, hitCount: 1 }];
    }

    return parsedPrevious.map((entry, index) => {
        if (index !== existingIndex) {
            return entry;
        }
        return {
            ...entry,
            format: parsedIncoming.format,
            scannedAt: parsedIncoming.scannedAt,
            hitCount: entry.hitCount + 1,
        };
    });
};

export const buildMockErpLookup = (barcode: string): BarcodeErpLookup => {
    const parsedBarcode = z.string().trim().min(1).parse(barcode);
    const seed = createDeterministicSeed(parsedBarcode);

    const itemCode = `ITM-${String(seed % 100000).padStart(5, '0')}`;
    const lotNo = `LOT-${String(seed % 10000).padStart(4, '0')}`;
    const warehouse = WAREHOUSE_OPTIONS[seed % WAREHOUSE_OPTIONS.length];
    const status = STATUS_OPTIONS[seed % STATUS_OPTIONS.length];
    const quantity = (seed % 90) + 10;
    const inspectedAt = dayjs('2026-01-01T00:00:00.000Z')
        .add(seed % 180, 'day')
        .add(seed % 24, 'hour')
        .format('YYYY-MM-DD HH:mm:ss');

    return BarcodeErpLookupSchema.parse({
        barcode: parsedBarcode,
        itemCode,
        itemName: `MOCK 품목 ${String(seed % 1000).padStart(3, '0')}`,
        lotNo,
        warehouse,
        quantity,
        inspectedAt,
        status,
    });
};

export const buildMockErpLookups = (barcodes: string[]): BarcodeErpLookup[] => {
    return z.array(z.string()).parse(barcodes).map((barcode) => buildMockErpLookup(barcode));
};
