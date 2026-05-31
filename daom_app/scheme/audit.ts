import { z } from 'zod';
import dayjs from '@/lib/dayjs';

/**
 * Audit Action Types
 */
export const AuditAction = z.enum([
    'CREATE',
    'READ',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'EXPORT',
    'EXTRACT',
    'WEBHOOK',
]);

export type AuditAction = z.infer<typeof AuditAction>;

/**
 * Audit Resource Types
 */
export const AuditResource = z.enum([
    'model',
    'document',
    'extraction',
    'template',
    'user',
    'group',
    'menu',
    'settings',
]);

export type AuditResource = z.infer<typeof AuditResource>;

/**
 * Audit Log Entry Schema
 */
export const AuditLogEntry = z.object({
    id: z.string().default(() => crypto.randomUUID()),
    timestamp: z.string().default(() => dayjs().utc().toISOString()),
    user_id: z.string(),
    user_email: z.string(),
    tenant_id: z.string(),
    action: AuditAction,
    resource_type: AuditResource,
    resource_id: z.string(),
    status: z.enum(['SUCCESS', 'FAILURE']).default('SUCCESS'),
    changes: z.record(z.string(), z.object({
        old: z.any().optional(),
        new: z.any().optional(),
    })).nullable().default(null),
    metadata: z.record(z.string(), z.any()).nullable().default(null),
    details: z.record(z.string(), z.any()).nullable().default(null),
    ip_address: z.string().nullable().default(null),
    user_agent: z.string().nullable().default(null),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

// Request Types
export const ListAuditLogsRequest = z.object({
    user_id: z.string().optional(),
    resource_type: AuditResource.optional(),
    action: AuditAction.optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
});

export type ListAuditLogsRequest = z.infer<typeof ListAuditLogsRequest>;

// Response Types
export const AuditLogResponse = AuditLogEntry;
export type AuditLogResponse = z.infer<typeof AuditLogResponse>;

export const AuditLogsListResponse = z.object({
    items: z.array(AuditLogResponse),
    total: z.number(),
});

export type AuditLogsListResponse = z.infer<typeof AuditLogsListResponse>;
