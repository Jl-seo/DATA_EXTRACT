import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, UpdateUserRoleRequest } from '@/scheme/user';
import {
    getCurrentUserInfo,
    listUsers,
    getUserById,
    updateUserRole,
} from '@/actions/user';

/**
 * 현재 사용자 정보 조회
 */
export function useCurrentUser() {
    return useQuery({
        queryKey: ['user', 'me'],
        queryFn: () => getCurrentUserInfo(),
        staleTime: 1000 * 60 * 5, // 5분
    });
}

/**
 * 사용자 목록 조회
 */
export function useUsers(search?: string) {
    return useQuery({
        queryKey: ['users', search],
        queryFn: () => listUsers(search),
    });
}

/**
 * 특정 사용자 조회
 */
export function useUser(userId: string) {
    return useQuery({
        queryKey: ['user', userId],
        queryFn: () => getUserById(userId),
        enabled: !!userId,
    });
}

/**
 * 사용자 역할 변경
 */
export function useUpdateUserRole() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateUserRoleRequest) => updateUserRole(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });
}
