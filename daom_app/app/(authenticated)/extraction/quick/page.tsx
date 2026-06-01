import { QuickExtraction } from '@/components/extraction/QuickExtraction';

export default function QuickExtractionPage() {
    return (
        <div className="flex flex-col h-full bg-background p-8 space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">빠른 추출</h1>
                    <p className="text-muted-foreground">모델 설정 없이 즉시 문서를 분석합니다.</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto w-full">
                <QuickExtraction />
            </div>
        </div>
    );
}
