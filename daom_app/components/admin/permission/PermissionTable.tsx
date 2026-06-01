'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Combobox } from '@/components/ui/combobox';
import { User, Users, Shield, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GlobalPermission,
  GlobalPermissionRoleType,
  GlobalPermissionUpdateRoleRequest,
} from '@/scheme/permission';
import { Activity } from 'react';
import { SpinnerWithText } from '@/components/ui/spinner';
import { memo } from 'react';

interface PermissionTableProps {
  users: GlobalPermission[];
  onRoleChange: (req: GlobalPermissionUpdateRoleRequest) => void;
  onDelete: (id: string) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleAll: (allIds: string[]) => void;
  className?: string;
  children?: React.ReactNode;
  isFetching?: boolean;
}

export const PermissionTable = memo(function PermissionTable({
  users,
  onRoleChange,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  className,
  children,
  isFetching,
}: PermissionTableProps) {
  const isAllSelected = users.length > 0 && selectedIds.length === users.length;
  const isSomeSelected =
    selectedIds.length > 0 && selectedIds.length < users.length;

  return (
    <Card
      className={cn(
        'border-slate-100 shadow-sm rounded-xl overflow-hidden bg-white flex flex-col gap-4',
        className,
      )}
    >
      <div className="flex-1 overflow-auto px-2">
        {/* 로딩... */}
        <Activity mode={isFetching ? 'visible' : 'hidden'}>
          <div className="w-full py-8 flex items-center justify-center">
            <SpinnerWithText text={'데이터 로딩중..'} />
          </div>
        </Activity>

        {/* 테이블 */}
        <Activity mode={!isFetching ? 'visible' : 'hidden'}>
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 px-4">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer transition-colors"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = isSomeSelected;
                    }}
                    onChange={() => onToggleAll(users.map((u) => u.id))}
                  />
                </TableHead>
                <TableHead className="w-87.5 font-bold text-slate-600">
                  이름 / 그룹
                </TableHead>
                <TableHead className="font-bold text-slate-600">
                  이메일
                </TableHead>
                <TableHead className="w-62.5 font-bold text-slate-600">
                  권한
                </TableHead>
                <TableHead className="w-25 font-bold text-slate-600 text-center">
                  삭제
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {users.map((user, idx) => {
                const isSelected = selectedIds.includes(user.id);
                return (
                  <TableRow
                    key={idx}
                    className={cn(
                      'hover:bg-slate-50/50 cursor-pointer transition-colors',
                      isSelected && 'bg-sky-50/30 hover:bg-sky-50/50',
                    )}
                    onClick={() => onToggleSelect(user.id)}
                  >
                    <TableCell
                      className="px-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer transition-colors"
                        checked={isSelected}
                        onChange={() => onToggleSelect(user.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                          {user?.target_type?.startsWith('group') ? (
                            <Users className="w-4 h-4" />
                          ) : (
                            <User className="w-4 h-4" />
                          )}
                        </div>
                        <span className="text-slate-700">
                          {user?.target?.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {user?.target?.upn}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Combobox
                        value={user?.role}
                        onValueChange={(val) => {
                          onRoleChange({
                            id: user?.id,
                            role: val as GlobalPermissionRoleType,
                          });
                        }}
                        options={[
                          { value: 'user', label: '사용자' },
                          { value: 'admin', label: '관리자' },
                        ]}
                        triggerClassName={cn(
                          'h-8 w-30 text-sm font-bold border-0 ring-1 ring-inset',
                          user?.role === 'admin'
                            ? 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100 hover:text-rose-800'
                            : 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 hover:text-emerald-800',
                        )}
                      >
                        {user?.role === 'admin' ? (
                          <Shield className="w-3 h-3" />
                        ) : (
                          <User className="w-3 h-3" />
                        )}
                      </Combobox>
                    </TableCell>
                    <TableCell
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                        onClick={() => onDelete(user?.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}

              {users.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-slate-400"
                  >
                    조건에 맞는 사용자가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Activity>
      </div>
      {children}
    </Card>
  );
});
