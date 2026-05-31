"use client";

import { useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { AddUserDialog } from "@/components/admin/permission/AddUserDialog";
import { PermissionTable } from "@/components/admin/permission/PermissionTable";
import { PermissionFilter } from "@/components/admin/permission/PermissionFilter";
import { Pagination } from "@/components/ui/pagination";
import { Plus } from "lucide-react";
import { DeleteConfirmDialog } from "@/components/common/DeleteConfirmDialog";
import { useQuery } from "@tanstack/react-query";
import { usePermission } from "@/hooks/usePermission";

export function PermissionContainer() {
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { listQuery, countQuery, currentPage, handlePageChange } = usePermission();

  const { data: permissions = [], isFetching } = useQuery(listQuery);
  const { data: count } = useQuery(countQuery);

  const { updatePermissionRole, deletePermission, deleteBulkPermissions } = usePermission();

  const onToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const onToggleAll = (allIds: string[]) => {
    setSelectedIds((prev) => (prev.length === allIds.length ? [] : allIds));
  };

  const handleDeleteUser = (id: string) => {
    setUserToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (userToDelete) {
      deletePermission({ id: userToDelete });
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  const confirmBulkDelete = () => {
    deleteBulkPermissions({ ids: selectedIds });
    setIsBulkDeleteDialogOpen(false);
    setSelectedIds([]);
  };

  return (
    <PageContainer maxWidth="full" className="p-4 lg:p-6 space-y-4 h-full flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <PageHeader
          title="권한 관리"
          description="시스템 접근 권한 및 관리자 설정을 관리합니다."
          className="mb-0"
        />

        <Button
          onClick={() => setIsAddUserDialogOpen(true)}
          className="bg-sky-600 hover:bg-sky-700 text-white gap-2 rounded-xl shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span className="font-bold text-sm">사용자 추가</span>
        </Button>
      </div>

      <AddUserDialog
        open={isAddUserDialogOpen}
        onOpenChange={setIsAddUserDialogOpen}
      />

      {/* Filtering Toolbar */}
      <div className="shrink-0">
        <PermissionFilter
          selectedCount={selectedIds.length}
          onBulkDelete={() => setIsBulkDeleteDialogOpen(true)}
        />
      </div>

      {/* Permission Table Area - Flex Grow to fill height */}
      <div className="flex-1 min-h-0 flex flex-col">
        <PermissionTable
          users={permissions}
          onRoleChange={updatePermissionRole}
          onDelete={handleDeleteUser}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onToggleAll={onToggleAll}
          className="flex-1 h-full"
          isFetching={isFetching}
        >
          <Pagination
            totalItems={count ?? 0}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            className="mt-auto bg-white border-t border-slate-50 p-2"
          />
        </PermissionTable>
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="사용자 권한 삭제"
        description="정말로 이 사용자/그룹의 권한을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
      />

      <DeleteConfirmDialog
        open={isBulkDeleteDialogOpen}
        onOpenChange={setIsBulkDeleteDialogOpen}
        onConfirm={confirmBulkDelete}
        title="사용자 권한 대량 삭제"
        description={`선택한 ${selectedIds.length}명의 권한을 정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
      />
    </PageContainer>
  );
}
