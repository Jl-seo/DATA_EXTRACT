'use server';
import 'server-only';

import { OpenAIService } from '@/services/OpenAIService';
import CosmosDBService from '@/services/CosmosDBService';
import BlobStorageService from '@/services/BlobStorageService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { ComparisonResult } from '@/scheme/comparison';
import { File } from '@/scheme/file';

export async function analyzeComparison(
    baselineFileId: string,
    candidateFileId: string
): Promise<ComparisonResult> {
    // 1. Setup Services & Auth
    const envConfig = await getCurrentEnvConfig();
    const permissionService = new PermissionService(envConfig);
    const user = await permissionService.getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const cosmosDBService = new CosmosDBService(envConfig);
    const blobStorageService = new BlobStorageService(envConfig);
    const openaiService = new OpenAIService(envConfig);

    // 2. Fetch Files Metadata
    const filesContainer = await cosmosDBService.getContainer('files');

    // Helper to fetch file
    const getFile = async (id: string): Promise<File> => {
        const { resources: files } = await filesContainer.items.query({
            query: 'SELECT * FROM c WHERE c.id = @id',
            parameters: [{ name: '@id', value: id }]
        }).fetchAll();

        if (!files || files.length === 0) {
            throw new Error(`File not found: ${id}`);
        }
        return files[0] as File;
    };

    const [baselineFile, candidateFile] = await Promise.all([
        getFile(baselineFileId),
        getFile(candidateFileId)
    ]);

    // 3. Generate Temp SAS URLs for Analysis
    // This copies the files to the isolated temp container and generates short-lived SAS URLs.
    const sasOptions = BlobStorageService.SAS.READ(60);
    const cleanups: (() => Promise<void>)[] = [];

    try {
        const [baselineResult, candidateResult] = await Promise.all([
            blobStorageService.generateTempSasUrl(`${envConfig.id}/${baselineFile.blob_path}`, sasOptions),
            blobStorageService.generateTempSasUrl(`${envConfig.id}/${candidateFile.blob_path}`, sasOptions)
        ]);

        if (baselineResult.cleanup) cleanups.push(baselineResult.cleanup);
        if (candidateResult.cleanup) cleanups.push(candidateResult.cleanup);

        // 4. Call OpenAI Service
        console.log(`[Comparison] Analyzing ${baselineFile.filename} vs ${candidateFile.filename} using temp blobs...`);
        
        const result = await openaiService.compareImages(baselineResult.sasUrl, candidateResult.sasUrl);
        return result as ComparisonResult;

    } catch (error: any) {
        console.error('[Comparison] Analysis failed:', error);
        return {
            differences: [],
            error: error.message || String(error)
        };
    } finally {
        // 5. Cleanup Temporary Blobs immediately after analysis
        if (cleanups.length > 0) {
            console.log(`[Comparison] Cleaning up ${cleanups.length} temporary blobs...`);
            await Promise.all(cleanups.map(c => c().catch(e => console.warn('[Comparison] Cleanup failed:', e))));
        }
    }
}
