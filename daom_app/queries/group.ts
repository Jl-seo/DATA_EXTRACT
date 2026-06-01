import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Group,
    CreateGroupRequest,
    UpdateGroupRequest,
    AddMemberRequest,
    RemoveMemberRequest,
    SetPermissionsRequest,
    DeleteGroupRequest,
} from '@/scheme/group';
import {
    listGroups,
    createGroup,
    getGroupById,
    updateGroup,
    addMemberToGroup,
    removeMemberFromGroup,
    setGroupPermissions,
    deleteGroup,
} from '@/actions/group';

/**
 * 그룹 목록 조회
 */
export function useGroups() {
    return useQuery({
        queryKey: ['groups'],
        queryFn: () => listGroups(),
    });
}

/**
 * 특정 그룹 조회
 */
export function useGroup(groupId: string) {
    return useQuery({
        queryKey: ['group', groupId],
        queryFn: () => getGroupById(groupId),
        enabled: !!groupId,
    });
}

/**
 * 그룹 생성
 */
export function useCreateGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateGroupRequest) => createGroup(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}

/**
 * 그룹 정보 수정
 */
export function useUpdateGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateGroupRequest) => updateGroup(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}

/**
 * 그룹에 멤버 추가
 */
export function useAddMemberToGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: AddMemberRequest) => addMemberToGroup(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}

/**
 * 그룹에서 멤버 제거
 */
export function useRemoveMemberFromGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: RemoveMemberRequest) => removeMemberFromGroup(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}

/**
 * 그룹 권한 설정
 */
export function useSetGroupPermissions() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SetPermissionsRequest) => setGroupPermissions(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}

/**
 * 그룹 삭제
 */
export function useDeleteGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: DeleteGroupRequest) => deleteGroup(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
        },
    });
}
