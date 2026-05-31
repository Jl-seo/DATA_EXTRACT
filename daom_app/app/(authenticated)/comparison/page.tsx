'use client';

import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ComparisonRunner } from '@/components/comparison/ComparisonRunner';

export default function ComparisonPage() {
    return (
        <PageContainer maxWidth="full" className="h-[calc(100vh-64px)] overflow-hidden">
            {/* 
                Since ComparisonRunner manages its own header title/desc when no result, 
                and we want full height for the viewer, we can skip standard PageHeader or make it minimal.
                Actually, let's keep it clean.
             */}
            <ComparisonRunner />
        </PageContainer>
    );
}
