import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Menu,
    CreateMenuRequest,
    UpdateMenuRequest,
    DeleteMenuRequest,
} from '@/scheme/menu';
import {
    listMenus,
    getAccessibleMenus,
    createMenu,
    updateMenu,
    deleteMenu,
} from '@/actions/menu';

/**
 * 모든 메뉴 조회
 */
export function useMenus() {
    return useQuery({
        queryKey: ['menus'],
        queryFn: () => listMenus(),
    });
}

/**
 * 접근 가능한 메뉴만 조회
 */
export function useAccessibleMenus() {
    return useQuery({
        queryKey: ['menus', 'accessible'],
        queryFn: () => getAccessibleMenus(),
    });
}

/**
 * 메뉴 생성
 */
export function useCreateMenu() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateMenuRequest) => createMenu(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['menus'] });
        },
    });
}

/**
 * 메뉴 수정
 */
export function useUpdateMenu() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateMenuRequest) => updateMenu(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['menus'] });
        },
    });
}

/**
 * 메뉴 삭제
 */
export function useDeleteMenu() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: DeleteMenuRequest) => deleteMenu(request),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['menus'] });
        },
    });
}
