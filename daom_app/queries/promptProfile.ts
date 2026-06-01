import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  confirmMetaPromptDraft,
  generateMetaPromptDraft,
  getPromptProfile,
  updateMetaPromptDraft,
} from '@/actions/promptProfile';
import type {
  ConfirmPromptDraftRequest,
  GenerateMetaPromptDraftRequest,
  UpdatePromptDraftRequest,
} from '@/scheme/promptProfile';

export function usePromptProfile(modelId: string) {
  return useQuery({
    queryKey: ['prompt-profile', modelId],
    queryFn: async () => await getPromptProfile(modelId),
    enabled: !!modelId,
  });
}

export function useGenerateMetaPromptDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: GenerateMetaPromptDraftRequest) => await generateMetaPromptDraft(req),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prompt-profile', variables.model_id] });
    },
  });
}

export function useConfirmMetaPromptDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: ConfirmPromptDraftRequest) => await confirmMetaPromptDraft(req),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prompt-profile', variables.model_id] });
    },
  });
}

export function useUpdateMetaPromptDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: UpdatePromptDraftRequest) => await updateMetaPromptDraft(req),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prompt-profile', variables.model_id] });
    },
  });
}
