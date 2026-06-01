import { Suspense } from 'react';
import DictionaryManagementView from '@/components/admin/dictionary/DictionaryManagementView';
import { Loader2 } from 'lucide-react';

export const metadata = {
    title: '통합 사전 관리 | DAOM',
    description: '전체 모델에서 사용하는 정규화 사전을 관리합니다.',
};

export default function DictionaryManagementPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
            </div>
        }>
            <DictionaryManagementView />
        </Suspense>
    );
}
