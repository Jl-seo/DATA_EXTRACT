'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Activity, Database, FileText, TrendingUp, CheckCircle2 } from 'lucide-react';
import { useDashboardStats } from '@/queries/dashboard';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-card/95 backdrop-blur-sm border border-border p-3 rounded-xl shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                    <p className="text-sm font-bold text-foreground">
                        추출 건수 : <span className="text-indigo-600 dark:text-indigo-400">{payload[0].value}</span>
                    </p>
                </div>
            </div>
        );
    }
    return null;
};
const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-card/95 backdrop-blur-sm border border-border p-3 rounded-xl shadow-xl ring-1 ring-black/5">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.fill }} />
                    <p className="text-sm font-bold text-foreground">
                        {payload[0].name} : <span className="text-primary">{payload[0].value}</span>
                    </p>
                </div>
            </div>
        );
    }
    return null;
};

export function DashboardStats() {
    const { data: stats, isLoading, isError } = useDashboardStats(7);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12 text-muted-foreground animate-pulse">
                데이터를 불러오는 중입니다...
            </div>
        );
    }

    if (isError || !stats || !stats.summary) {
        return (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
                데이터를 불러오지 못했습니다.
            </div>
        );
    }

    const { summary, daily_trend, model_usage, recent_activity } = stats;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KPICard
                    title="총 추출 건수"
                    value={summary.total_extractions}
                    icon={Database}
                    description="최근 7일 처리량"
                />
                <KPICard
                    title="성공률"
                    value={`${summary.success_rate}%`}
                    icon={CheckCircle2}
                    description="최근 7일 평균 성공률"
                />
                <KPICard
                    title="활성 모델"
                    value={summary.active_models}
                    icon={FileText}
                    description="사용 중인 데이터 모델"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Daily Trend Chart */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            일별 추출 현황
                        </CardTitle>
                        <CardDescription>최근 7일간의 문서 처리량 추이</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={daily_trend}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(99, 102, 241, 0.04)' }}
                                    content={<CustomTooltip />}
                                />
                                <Bar
                                    dataKey="count"
                                    fill="#6366f1"
                                    radius={[4, 4, 0, 0]}
                                    // 0건일 때 막대가 보이지 않도록 처리
                                    minPointSize={0}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Model Usage Chart */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-500" />
                            모델별 사용량
                        </CardTitle>
                        <CardDescription>최근 7일 모델 사용량</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px] flex flex-col items-center justify-center">
                        {model_usage.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={model_usage}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={90}
                                            paddingAngle={5}
                                            dataKey="value"
                                            stroke="hsl(var(--background))"
                                            strokeWidth={2}
                                        >
                                            {model_usage.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomPieTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="flex flex-wrap justify-center gap-3 mt-4">
                                    {model_usage.map((entry, index) => (
                                        <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-full">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                            <span className="font-medium">{entry.name}</span>
                                            <span className="opacity-70">({entry.value})</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="text-sm text-muted-foreground flex items-center justify-center h-full">데이터가 없습니다.</div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Recent Activity Mini Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">최근 추출 현황</CardTitle>
                    <CardDescription>최근 5건의 추출 작업 로그</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {recent_activity.length > 0 ? (
                            recent_activity.map((activity) => (
                                <div key={activity.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/5 transition-colors">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-semibold text-foreground">{activity.model}</span>
                                        <span className="text-xs text-muted-foreground truncate max-w-[300px]" title={activity.filename}>
                                            📄 {activity.filename}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 min-w-fit">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary ring-1 ring-primary/20">
                                                {activity.user.substring(0, 1).toUpperCase()}
                                            </div>
                                            <span className="text-xs font-medium text-muted-foreground">{activity.user}</span>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <span className={`text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full font-medium ${activity.status === 'success'
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800'
                                                : activity.status === 'processing'
                                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800'
                                                    : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800'
                                                }`}>
                                                {activity.status.toUpperCase()}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground/70">
                                                {new Date(activity.timestamp).toLocaleString('ko-KR', {
                                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-6 text-sm text-muted-foreground bg-secondary/20 rounded-lg">
                                최근 추출 활동이 없습니다.
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function KPICard({ title, value, icon: Icon, description }: any) {
    return (
        <Card className="overflow-hidden relative group">
            <div className="absolute inset-0 bg-linear-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <CardContent className="p-6">
                <div className="flex items-center justify-between space-y-0 pb-2">
                    <p className="text-sm font-medium text-muted-foreground">
                        {title}
                    </p>
                    <div className="p-2 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
                        <Icon className="h-4 w-4 text-primary" />
                    </div>
                </div>
                <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
                <p className="text-xs text-muted-foreground mt-2">
                    {description}
                </p>
            </CardContent>
        </Card>
    );
}
