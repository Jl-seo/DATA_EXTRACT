import { DashboardStats } from '@/components/admin/DashboardStats';

export default function AdminDashboardPage() {
    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">대시보드</h1>
                <p className="text-muted-foreground mt-2">
                    시스템의 전반적인 추출 통계 및 활동 내역을 확인합니다.
                </p>
            </div>

            <DashboardStats />
        </div>
    );
}
