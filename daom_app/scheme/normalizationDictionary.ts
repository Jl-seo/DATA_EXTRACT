import { z } from 'zod';

/**
 * 정규화 사전 항목 스키마
 * 추출된 데이터를 특정 코드나 표준 명칭으로 변환하기 위해 사용됩니다.
 */
export const NormalizationDictionarySchema = z.object({
    id: z.string().optional(),
    category: z.string().describe('사전 카테고리 (예: PORT, CARRIER, ROUTE)'),
    code: z.string().describe('원본 시스템 코드 또는 고유 ID'),
    name: z.string().describe('정규화된 표준 명칭'),
    aliases: z.array(z.string()).default([]).describe('검색 및 매핑에 사용될 유사 키워드 목록'),
    description: z.string().optional().describe('항목에 대한 추가 설명'),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

export type NormalizationDictionary = z.infer<typeof NormalizationDictionarySchema>;

/**
 * 사전 요약 정보 (카테고리별 통계)
 */
export const DictionaryCategorySummarySchema = z.object({
    category: z.string(),
    count: z.number(),
    last_updated: z.string().optional(),
    description: z.string().optional(),
});

export type DictionaryCategorySummary = z.infer<typeof DictionaryCategorySummarySchema>;
