import { NextRequest, NextResponse } from "next/server";
import { listAuditLogs } from "@/actions/audit";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);

        let limit = parseInt(searchParams.get('limit') || '50', 10);
        if (isNaN(limit) || limit < 1) limit = 50;
        if (limit > 100) limit = 100;

        let offset = parseInt(searchParams.get('offset') || '0', 10);
        if (isNaN(offset) || offset < 0) offset = 0;

        const action = searchParams.get('action') as any || undefined;
        const resourceType = searchParams.get('resourceType') as any || undefined;
        const startDate = searchParams.get('startDate') || undefined;
        const endDate = searchParams.get('endDate') || undefined;

        // listAuditLogs 함수 내부에서 권한 검사(Admin) 및 환경설정을 모두 수행합니다.
        const result = await listAuditLogs({
            offset,
            limit,
            action,
            resource_type: resourceType,
            start_date: startDate,
            end_date: endDate
        });

        return NextResponse.json({
            success: true,
            total: result.total,
            data: result.items
        });

    } catch (error: any) {
        console.error('[Audit API Error]', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal Server Error' },
            { status: error.message === 'Unauthorized' || error.message === '권한이 없습니다' || error.message === '인증되지 않은 사용자입니다' ? 401 : 500 }
        );
    }
}

