import { Upload, FileCheck, CheckCircle2, type LucideIcon } from 'lucide-react';

export interface WizardStep {
    id: 'upload' | 'review' | 'complete';
    label: string;
    description: string;
    icon: LucideIcon;
}

export const WIZARD_STEPS: WizardStep[] = [
    { id: 'upload', label: '문서 업로드', description: '분석할 문서를 추가하세요', icon: Upload },
    { id: 'review', label: '데이터 검토', description: '추출 데이터를 확인하세요', icon: FileCheck },
    { id: 'complete', label: '완료', description: '결과를 저장하세요', icon: CheckCircle2 }
];

export interface ReviewTab {
    id: string;
    label: string;
    icon?: LucideIcon;
}

export const REVIEW_TABS: ReviewTab[] = [
    { id: 'fields', label: '추출 필드' },
    { id: 'table', label: '상세 테이블' },
    { id: 'raw', label: 'Raw Data' }
];

export const ACCEPTED_FILE_TYPES = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls'];
export const ACCEPTED_MIME_TYPES = [
    'application/pdf', 
    'image/jpeg', 
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
];

export const POLLING_INTERVAL_MS = 2000;
export const MAX_POLLING_ATTEMPTS = 60;

export const CONFIDENCE_THRESHOLDS = {
    HIGH: 0.9,
    MEDIUM: 0.7,
    LOW: 0.5
};

export const getConfidenceColor = (confidence: number): string => {
    if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return 'text-chart-2';
    if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'text-chart-4';
    return 'text-destructive';
};

export const getConfidenceBadgeVariant = (confidence: number): 'secondary' | 'destructive' => {
    return confidence >= CONFIDENCE_THRESHOLDS.MEDIUM ? 'secondary' : 'destructive';
};
