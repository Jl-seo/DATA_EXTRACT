import { z } from 'zod';

export const DashboardSummaryScheme = z.object({
    total_extractions: z.number(),
    success_rate: z.number(),
    active_models: z.number(),
});

export const DailyTrendScheme = z.object({
    date: z.string(),
    count: z.number(),
});

export const ModelUsageScheme = z.object({
    name: z.string(),
    value: z.number(),
});

export const RecentActivityScheme = z.object({
    id: z.string(),
    model: z.string(),
    filename: z.string(),
    status: z.string(),
    timestamp: z.string(),
    user: z.string(),
});

export const DashboardStatsResponseScheme = z.object({
    summary: DashboardSummaryScheme,
    daily_trend: z.array(DailyTrendScheme),
    model_usage: z.array(ModelUsageScheme),
    recent_activity: z.array(RecentActivityScheme),
});

export type DashboardStatsResponse = z.infer<typeof DashboardStatsResponseScheme>;
