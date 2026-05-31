import 'server-only';
import { NormalizationDictionary, NormalizationDictionarySchema, DictionaryCategorySummary } from '@/scheme/normalizationDictionary';
import CosmosDBService from './CosmosDBService';
import BaseService from './BaseService';
import { DAOMEnvConfig } from '@/scheme/env';

export default class DictionaryService extends BaseService {
    cosmosDBService: CosmosDBService;

    constructor(envConfig: DAOMEnvConfig) {
        super(envConfig);
        this.cosmosDBService = new CosmosDBService(envConfig);
    }

    private async getContainer() {
        return await this.cosmosDBService.getContainer('normalization_dictionaries');
    }

    /**
     * 등록된 모든 카테고리와 아이템 개수 요약 정보를 조회합니다.
     */
    async getCategories(): Promise<DictionaryCategorySummary[]> {
        const container = await this.getContainer();
        const querySpec = {
            query: `
                SELECT 
                    c.category, 
                    COUNT(1) as count, 
                    MAX(c._ts) as last_updated_ts
                FROM c 
                GROUP BY c.category
            `
        };

        const { resources } = await container.items.query<any>(querySpec).fetchAll();

        return resources.map(r => ({
            category: r.category,
            count: r.count,
            last_updated: r.last_updated_ts ? new Date(r.last_updated_ts * 1000).toISOString() : undefined
        }));
    }

    /**
     * 특정 카테고리의 사전 아이템 목록을 조회합니다.
     */
    async getItems(category: string, offset: number = 0, limit: number = 1000): Promise<{ items: NormalizationDictionary[], total: number }> {
        const container = await this.getContainer();

        // Total count
        const countQuerySpec = {
            query: 'SELECT VALUE COUNT(1) FROM c WHERE c.category = @category',
            parameters: [{ name: '@category', value: category }]
        };
        const { resources: countRes } = await container.items.query<number>(countQuerySpec).fetchAll();
        const total = countRes[0] || 0;

        // Items
        const querySpec = {
            query: `SELECT * FROM c WHERE c.category = @category OFFSET @offset LIMIT @limit`,
            parameters: [
                { name: '@category', value: category },
                { name: '@offset', value: offset },
                { name: '@limit', value: limit }
            ]
        };
        const { resources } = await container.items.query<NormalizationDictionary>(querySpec).fetchAll();

        return { items: resources, total };
    }

    /**
     * 사전 통합 검색
     */
    async search(query: string, category?: string): Promise<NormalizationDictionary[]> {
        const container = await this.getContainer();
        let queryString = `
            SELECT * FROM c 
            WHERE (CONTAINS(LOWER(c.code), LOWER(@query)) 
               OR CONTAINS(LOWER(c.name), LOWER(@query)) 
               OR EXISTS(SELECT VALUE a FROM a IN c.aliases WHERE CONTAINS(LOWER(a), LOWER(@query))))
        `;
        const parameters = [{ name: '@query', value: query }];

        if (category && category !== 'all') {
            queryString += ` AND c.category = @category`;
            parameters.push({ name: '@category', value: category });
        }

        const querySpec = {
            query: queryString,
            parameters
        };

        const { resources } = await container.items.query<NormalizationDictionary>(querySpec).fetchAll();
        return resources;
    }

    /**
     * 대량 저장 (업로드)
     * 기존 카테고리 데이터는 유지한 채 새로운 데이터를 추가하거나 업데이트합니다.
     * (동일 코드 존재 시 업데이트)
     */
    async bulkUpload(category: string, items: Omit<NormalizationDictionary, 'id' | 'category'>[]): Promise<{ success: number, failure: number }> {
        const container = await this.getContainer();
        let success = 0;
        let failure = 0;

        const timestamp = new Date().toISOString();

        for (const item of items) {
            try {
                // 기존 데이터 확인 (category + code 조합)
                const querySpec = {
                    query: 'SELECT * FROM c WHERE c.category = @category AND c.code = @code',
                    parameters: [
                        { name: '@category', value: category },
                        { name: '@code', value: item.code }
                    ]
                };
                const { resources } = await container.items.query<NormalizationDictionary>(querySpec).fetchAll();

                const data: NormalizationDictionary = {
                    ...item,
                    category,
                    updated_at: timestamp
                };

                if (resources.length > 0) {
                    const existing = resources[0];
                    await container.item(existing.id!, category).replace({
                        ...existing,
                        ...data
                    });
                } else {
                    await container.items.create({
                        ...data,
                        created_at: timestamp,
                        partition_key: category // partitionKey는 카테고리로 지정 (이전 CosmosDBService 설정 참고)
                    });
                }
                success++;
            } catch (error) {
                console.error(`[DictionaryService] Upload failed for code ${item.code}:`, error);
                failure++;
            }
        }

        return { success, failure };
    }

    /**
     * 특정 카테고리의 모든 데이터를 삭제합니다.
     */
    async deleteCategory(category: string): Promise<{ success: boolean }> {
        const container = await this.getContainer();

        // 해당 카테고리의 모든 아이템 조회
        const { resources: items } = await container.items
            .query<NormalizationDictionary>({
                query: 'SELECT c.id, c.category FROM c WHERE c.category = @category',
                parameters: [{ name: '@category', value: category }]
            })
            .fetchAll();

        if (items.length === 0) return { success: true };

        // CosmosDBService의 deleteAll을 사용하여 삭제
        const operations = items.map(item => ({
            operationType: 'Delete' as const,
            id: item.id!,
            partitionKey: item.category
        }));

        // 직접 bulk 비출
        for (let i = 0; i < operations.length; i += 100) {
            const chunk = operations.slice(i, i + 100);
            await container.items.bulk(chunk);
        }
        return { success: true };
    }

    /**
     * 단일 사전 항목을 수정합니다.
     */
    async updateItem(id: string, category: string, data: Partial<NormalizationDictionary>): Promise<{ success: boolean }> {
        const container = await this.getContainer();

        try {
            const { resource: existing } = await container.item(id, category).read();
            if (!existing) throw new Error('항목을 찾을 수 없습니다.');

            await container.item(id, category).replace({
                ...existing,
                ...data,
                category, // 카테고리는 유지 또는 명시적 지정
                updated_at: new Date().toISOString()
            });

            return { success: true };
        } catch (e) {
            console.error('Failed to update dictionary item:', e);
            throw new Error('데이터 수정 실패');
        }
    }

    /**
     * 단일 사전 항목을 삭제합니다.
     */
    async deleteItem(id: string, category: string): Promise<{ success: boolean }> {
        const container = await this.getContainer();
        try {
            await container.item(id, category).delete();
            return { success: true };
        } catch (e) {
            console.error('Failed to delete dictionary item:', e);
            throw new Error('데이터 삭제 실패');
        }
    }

    /**
     * 특정 추출값을 정규화 사전에서 검색하여 표준 코드(code)로 변환합니다.
     */
    async normalizeValue(category: string, value: string): Promise<string | null> {
        if (!value) return null;


        const container = await this.getContainer();
        const querySpec = {
            query: `
                SELECT TOP 1 c.code 
                FROM c 
                WHERE (c.category = @category OR LOWER(c.category) = LOWER(@category))
                  AND (
                      LOWER(c.code) = LOWER(@value) OR
                      LOWER(c.name) = LOWER(@value) OR
                      EXISTS(SELECT VALUE a FROM a IN c.aliases WHERE LOWER(a) = LOWER(@value))
                  )
            `,
            parameters: [
                { name: '@category', value: category },
                { name: '@value', value: value.trim() }
            ]
        };

        try {
            const { resources } = await container.items.query<{ code: string }>(querySpec).fetchAll();
            const result = resources.length > 0 ? resources[0].code : null;

            return result;
        } catch (error) {
            console.error('[DictionaryService] Query failed:', error);
            return null;
        }
    }

    /**
     * 카테고리 전체를 조회하여 인메모리 검색용 Lookup Map을 반환합니다. (성능 최적화용)
     */
    async getCategoryLookup(category: string): Promise<Map<string, string>> {

        const container = await this.getContainer();
        const lookup = new Map<string, string>();

        try {
            const querySpec = {
                query: `SELECT c.code, c.name, c.aliases FROM c WHERE c.category = @category OR LOWER(c.category) = LOWER(@category)`,
                parameters: [{ name: '@category', value: category }]
            };

            const { resources } = await container.items.query<any>(querySpec).fetchAll();

            for (const item of resources) {
                const code = item.code;
                if (!code) continue;

                // 1. Code 매핑
                lookup.set(code.toLowerCase(), code);

                // 2. Name 매핑
                if (item.name) {
                    lookup.set(item.name.toLowerCase(), code);
                }

                // 3. Aliases 매핑
                if (Array.isArray(item.aliases)) {
                    for (const alias of item.aliases) {
                        if (alias) {
                            lookup.set(alias.toLowerCase(), code);
                        }
                    }
                }
            }


            return lookup;
        } catch (error) {
            console.error('[DictionaryService] Failed to build lookup Map:', error);
            return lookup; // 빈 맵 반환
        }
    }
}
