import {
  buildGlobalPermissionCountQuery,
  useGlobalPermissionDelete,
  useGlobalPermissionUpdateRole,
  useGlobalPermissionsCreate,
  useGlobalPermissionBulkDelete
} from "@/queries/permission";
import { useCallback, useMemo } from "react";
import {
  GlobalPermission,
  GlobalPermissionDeleteRequest,
  GlobalPermissionUpdateRoleRequest,
  GlobalPermissionsCreateRequest,
  GlobalPermissionBulkDeleteRequest
} from "@/scheme/permission";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { buildGlobalPermissionListQuery } from "@/queries/permission";
import { useQueryStates } from "nuqs";
import { globalPermissionSearchParamParsers } from "@/app/(authenticated)/admin/permissions/searchParams";
import * as R from 'remeda';

export function usePermission() {
  const queryClient = useQueryClient();
  const [params, setParams] = useQueryStates(globalPermissionSearchParamParsers, {
    shallow: false,
  });

  const listQuery = useMemo(() => buildGlobalPermissionListQuery(params), [params]);
  const countQuery = useMemo(() => buildGlobalPermissionCountQuery(params), [params]);

  const { mutate: createPermissions } = useGlobalPermissionsCreate();
  const { mutate: deletePermissionMutate } = useGlobalPermissionDelete();
  const { mutate: deleteBulkMutate } = useGlobalPermissionBulkDelete();
  const { mutate: updatePermissions } = useGlobalPermissionUpdateRole();

  // 사용자 권한 추가
  const addPermissions = useCallback((req: GlobalPermissionsCreateRequest) => {
    createPermissions(req, {
      onSuccess: (result: GlobalPermission[]) => {
        queryClient.invalidateQueries({
          queryKey: [...listQuery.queryKey],
        });
        queryClient.invalidateQueries({
          queryKey: [...countQuery.queryKey],
        });
        toast.success("사용자 권한이 추가되었습니다.");
      },
      onError: () => {
        toast.error("사용자 권한 추가에 실패했습니다.");
      },
    });
  }, [createPermissions, queryClient, listQuery.queryKey, countQuery.queryKey]);

  // 사용자 권한 삭제
  const deletePermission = useCallback((req: GlobalPermissionDeleteRequest) => {
    deletePermissionMutate(req, {
      onSuccess: (result: { statusCode: number; item: { id: string } }) => {
        queryClient.setQueryData([...listQuery.queryKey], (_permissions: GlobalPermission[]) => {
          return (_permissions ?? [])?.filter((p) =>
            p.id !== result?.item?.id,
          )
        });
        queryClient.setQueryData([...countQuery.queryKey], (_count: number) => {
          return (_count ?? 0) - 1;
        });
        toast.success("사용자 권한이 삭제되었습니다.");
      },
      onError: () => {
        toast.error("사용자 권한 삭제에 실패했습니다.");
      },
    });
  }, [listQuery, countQuery, deletePermissionMutate, queryClient]);

  // 사용자 권한 대량 삭제
  const deleteBulkPermissions = useCallback((req: GlobalPermissionBulkDeleteRequest) => {
    deleteBulkMutate(req, {
      onSuccess: (result: { successCount: number; items: GlobalPermission[]; errors: string[] }) => {
        queryClient.invalidateQueries({
          queryKey: [...listQuery.queryKey],
        });
        queryClient.invalidateQueries({
          queryKey: [...countQuery.queryKey],
        });
        toast.success(`${result.successCount}개의 권한이 삭제되었습니다.`);
      },
      onError: () => {
        toast.error("권한 삭제에 실패했습니다.");
      },
    });
  }, [listQuery, countQuery, deleteBulkMutate, queryClient]);

  // 사용자 권한 수정
  const updatePermissionRole = useCallback((req: GlobalPermissionUpdateRoleRequest) => {
    updatePermissions(req, {
      onSuccess: (result: { statusCode: number; item: GlobalPermission | undefined }) => {
        queryClient.setQueryData([...listQuery.queryKey], (_permissions: GlobalPermission[]) => {
          return (_permissions ?? [])?.map((p) =>
            p.id === result?.item?.id ? result.item ?? p : p,
          )
        });
        toast.success("사용자 권한이 수정되었습니다.");
      },
      onError: () => {
        toast.error("사용자 권한 수정에 실패했습니다.");
      },
    });
  }, [listQuery, updatePermissions, queryClient]);


  const currentPage = useMemo(() => {
    return R.ceil(params.offset / params.pageSize, 0) + 1;
  }, [params.offset, params.pageSize]);

  // 페이지네이션 
  const handlePageChange = (page: number) => {
    setParams({
      ...params,
      offset: params.pageSize * (page - 1)
    })
  }

  return {
    currentPage,
    listQuery,
    countQuery,
    addPermissions,
    deletePermission,
    deleteBulkPermissions,
    updatePermissionRole,
    handlePageChange,
  };
}