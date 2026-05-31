import { NextResponse } from 'next/server';
import { getExtractionStats } from '@/actions/extractionLog';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ modelId: string }> }
) {
    try {
        const { modelId } = await params;
        const stats = await getExtractionStats(modelId);
        return NextResponse.json(stats);
    } catch (error: any) {
        console.error('[API] Failed to fetch extraction stats:', error.message);
        return NextResponse.json(
            { error: 'Failed to fetch extraction stats', message: error.message },
            { status: 500 }
        );
    }
}
