import { QuickExtractionRunner } from '@/components/extraction/QuickExtractionRunner';

export default function QuickExtractionPage() {
    return (
        <div className="p-8 h-full flex flex-col">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">
                    빠른 추출 (Quick Extraction)
                </h1>
                <p className="text-slate-500 mt-1">
                    모델 설정 없이 모든 문서를 즉시 분석합니다.
                </p>
            </div>

            <div className="flex-1 min-h-0">
                <QuickExtractionRunner />
            </div>
        </div>
    );
}
