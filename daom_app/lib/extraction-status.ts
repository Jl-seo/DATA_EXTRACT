/**
 * 추출 작업 상태 판별 헬퍼 함수들
 */

export function isSuccessStatus(status: string): boolean {
    return status === 'success' || status === 'completed';
}

export function isProcessingStatus(status: string): boolean {
    return status === 'processing' || status === 'pending' || status === 'running';
}

export function isErrorStatus(status: string): boolean {
    return status === 'error' || status === 'failed';
}

export function isCancelledStatus(status: string): boolean {
    return status === 'cancelled' || status === 'canceled';
}
