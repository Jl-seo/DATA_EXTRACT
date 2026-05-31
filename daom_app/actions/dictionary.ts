'use server';

import { getCurrentEnvConfig } from '@/lib/env';
import DictionaryService from '@/services/DictionaryService';
import { NormalizationDictionary, DictionaryCategorySummary } from '@/scheme/normalizationDictionary';
import * as XLSX from 'xlsx';
import { revalidatePath } from 'next/cache';

/**
 * 사전 카테고리 목록 조회
 */
export async function getDictionaryCategories(): Promise<DictionaryCategorySummary[]> {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    return await service.getCategories();
}

/**
 * 특정 카테고리의 사전 아이템 조회
 */
export async function getDictionaryItems(category: string, offset: number = 0, limit: number = 1000) {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    return await service.getItems(category, offset, limit);
}

/**
 * 사전 통합 검색
 */
export async function searchDictionary(query: string, category?: string) {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    return await service.search(query, category);
}

/**
 * 사전 데이터 업로드 (Excel/CSV)
 * @param category 대상 카테고리
 * @param formData 파일 데이터가 포함된 FormData
 */
export async function uploadDictionaryData(category: string, formData: FormData) {
    const file = formData.get('file') as File;
    if (!file) throw new Error('파일이 업로드되지 않았습니다.');

    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // JSON 변환 (헤더가 없는 경우 대비하여 row 단위로 읽기)
    const rawData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
    
    // 첫 줄이 헤더라고 가정하고 필터링 (최소 2개 컬럼 필요: 코드, 명칭)
    const items: Omit<NormalizationDictionary, 'id' | 'category'>[] = rawData
        .filter((row, index) => index > 0 && row.length >= 2) // 헤더 제외 및 유효성 검사
        .map(row => {
            const code = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            
            // 동의어 처리 (동의어1, 동의어2 컬럼 합치기)
            const aliases: string[] = [];
            
            // 동의어1 (쉼표 구분 대응 포함)
            if (row[2]) {
                const a1 = String(row[2]).split(',').map(s => s.trim()).filter(Boolean);
                aliases.push(...a1);
            }
            
            // 동의어2
            if (row[3]) {
                const a2 = String(row[3]).split(',').map(s => s.trim()).filter(Boolean);
                aliases.push(...a2);
            }

            return {
                code,
                name,
                aliases: Array.from(new Set(aliases)), // 중복 제거
            };
        })
        .filter(item => item.code && item.name); // 필수값 체크

    const result = await service.bulkUpload(category, items);
    
    revalidatePath('/admin/dictionary');
    return result;
}

/**
 * 사전 카테고리 전체 삭제
 */
export async function deleteDictionaryCategory(category: string) {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    const result = await service.deleteCategory(category);
    
    revalidatePath('/admin/dictionary');
    return result;
}

/**
 * 사전 항목 수정
 */
export async function updateDictionaryItem(id: string, category: string, data: Partial<NormalizationDictionary>) {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    const result = await service.updateItem(id, category, data);
    
    // 사전 관련 모든 페이지 캐시 갱신
    revalidatePath('/admin/dictionary');
    revalidatePath('/admin/model-studio');
    
    return result;
}

/**
 * 사전 항목 삭제
 */
export async function deleteDictionaryItem(id: string, category: string) {
    const config = await getCurrentEnvConfig();
    const service = new DictionaryService(config);
    const result = await service.deleteItem(id, category);
    
    revalidatePath('/admin/dictionary');
    return result;
}
