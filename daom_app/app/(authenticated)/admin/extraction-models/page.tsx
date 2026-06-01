import { ModelList } from "@/components/extraction/ModelList";

export default function ExtractionModelsPage() {
    return (
        <div className="flex flex-col h-full bg-background p-8 space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">추출 모델 관리</h1>
                    <p className="text-muted-foreground">문서 추출을 위한 모델을 정의하고 관리합니다.</p>
                </div>
            </div>
            <ModelList />
        </div>
    );
}
