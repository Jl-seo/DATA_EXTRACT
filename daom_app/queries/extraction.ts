import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';

import {
    createExtractionModel,
    deleteExtractionModel,
    duplicateExtractionModel,
    type DuplicateExtractionModelRequest,
    getExtractionModelNameMapByIds,
    getExtractionModel,
    listExtractionModels,
    updateExtractionModel,
} from '@/actions/extractionModel';
import {
    getExtractionLog,
    listExtractionLogs,
} from '@/actions/extractionLog';
import { startExtraction } from '@/actions/extraction';
import {
    ExtractionModelCreateRequest,
    ExtractionModelListRequest,
    ExtractionModelUpdateRequest,
} from '@/scheme/extractionModel';
import { ExtractionLogListRequest } from '@/scheme/extractionLog';

// --- Extraction Models ---

export const useExtractionModels = (req: ExtractionModelListRequest = { offset: 0, pageSize: 10 }) => {
    return useQuery({
        queryKey: ['extractionModels', req],
        queryFn: async () => {
            const res = await listExtractionModels(req);
            return res as import('@/scheme/extractionModel').ExtractionModel[];
        },
        placeholderData: keepPreviousData,
    });
};

export const useExtractionModelsCount = (req: ExtractionModelListRequest = { offset: 0, pageSize: 10 }) => {
    return useQuery({
        queryKey: ['extractionModels', req, 'count'],
        queryFn: async () => {
            const res = await listExtractionModels(req, true);
            return res as number;
        },
        placeholderData: keepPreviousData,
    });
};

export const useExtractionModel = (id: string) => {
    return useQuery({
        queryKey: ['extractionModels', id],
        queryFn: () => getExtractionModel(id),
        enabled: !!id,
    });
};

export const useExtractionModelNameMapByIds = (modelIds: string[]) => {
    const normalized = Array.from(new Set(modelIds.filter(Boolean))).sort();
    return useQuery({
        queryKey: ['extractionModels', 'nameMapByIds', normalized],
        queryFn: async () => {
            return await getExtractionModelNameMapByIds(normalized);
        },
        enabled: normalized.length > 0,
        staleTime: 60_000,
    });
};

export const useCreateExtractionModel = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: ExtractionModelCreateRequest) => createExtractionModel(req),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['extractionModels'] });
        },
    });
};

export const useDuplicateExtractionModel = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: DuplicateExtractionModelRequest) => duplicateExtractionModel(req),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['extractionModels'] });
            if (data?.id) {
                queryClient.invalidateQueries({ queryKey: ['extractionModels', data.id] });
            }
        },
    });
};

export const useUpdateExtractionModel = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: ExtractionModelUpdateRequest) => updateExtractionModel(req),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['extractionModels'] });
            if (data?.id) {
                queryClient.invalidateQueries({ queryKey: ['extractionModels', data.id] });
            }
        },
    });
};

export const useDeleteExtractionModel = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteExtractionModel(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['extractionModels'] });
        },
    });
};

// --- Extraction Logs ---

export const useExtractionLogs = (req: ExtractionLogListRequest = { offset: 0, pageSize: 10 }) => {
    return useQuery({
        queryKey: ['extractionLogs', req],
        queryFn: async () => {
            const res = await listExtractionLogs(req);
            return res as import('@/scheme/extractionLog').ExtractionLog[];
        },
        placeholderData: keepPreviousData,
    });
};

export const useExtractionLogsCount = (req: ExtractionLogListRequest = { offset: 0, pageSize: 10 }) => {
    return useQuery({
        queryKey: ['extractionLogs', req, 'count'],
        queryFn: async () => {
            const res = await listExtractionLogs(req, true);
            return res as number;
        },
        placeholderData: keepPreviousData,
    });
};

export const useExtractionLog = (id: string) => {
    return useQuery({
        queryKey: ['extractionLogs', id],
        queryFn: () => getExtractionLog(id),
        enabled: !!id,
        refetchInterval: (query) => {
            // Poll if status is processing
            const status = query.state.data?.status;
            if (status === 'processing' || status === 'pending') {
                return 2000;
            }
            return false;
        }
    });
};

// --- Extraction Execution ---

export const useStartExtraction = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ fileId, modelId }: { fileId: string; modelId: string }) =>
            startExtraction(fileId, modelId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['extractionLogs'] });
        },
    });
};
