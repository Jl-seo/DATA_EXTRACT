'use client';

import {
  GlobalPermissionSelectedUser,
  GlobalPermissionUpdateRoleRequest,
} from '@/scheme/permission';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Activity, memo } from 'react';

export const SelectedUsers = memo(function SelectedUsers({
  selectedItems,
  toggleSelection,
  updateRole,
  hasPermission = true,
}: {
  selectedItems: Map<string, GlobalPermissionSelectedUser>;
  toggleSelection: (user: GlobalPermissionSelectedUser) => void;
  updateRole: (req: GlobalPermissionUpdateRoleRequest) => void;
  hasPermission?: boolean;
}) {
  return (
    <div className="hidden md:flex flex-col w-[45%] shrink-0 p-6 pt-0 bg-slate-50/50">
      <div className="flex items-center justify-between mb-4 mt-1">
        <h3 className="font-bold text-slate-700">
          {hasPermission ? '선택된' : '공유된'} 사용자 ({selectedItems.size}명)
        </h3>
      </div>

      <div className="border-t border-slate-200" />

      <ScrollArea className="flex-1 mt-4 pr-2 overflow-y-auto">
        <div className="space-y-2">
          {Array.from(selectedItems).map(([id, user]) => {
            return (
              <div
                key={id}
                className="flex items-center justify-between p-2.5 bg-white rounded-lg shadow-sm border border-slate-200"
              >
                <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0 mr-4">
                  <div className="w-8 h-8 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center shrink-0">
                    {user.target_type === 'user' ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Users className="w-4 h-4" />
                    )}
                  </div>
                  <span className="text-sm font-medium truncate max-w-34.5">
                    {user.target.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Activity mode={hasPermission ? 'visible' : 'hidden'}>
                    <div className="flex bg-slate-100 p-0.5 rounded-md">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'h-auto px-2 py-0.5 text-sm rounded-sm transition-colors hover:bg-transparent',
                          user.role === 'user'
                            ? 'bg-white text-slate-700 shadow-sm font-medium hover:bg-white'
                            : 'text-slate-400 hover:text-slate-600',
                        )}
                        onClick={() => updateRole({ id, role: 'user' })}
                      >
                        사용자
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'h-auto px-2 py-0.5 text-sm rounded-sm transition-colors hover:bg-transparent',
                          user.role === 'admin'
                            ? 'bg-white text-slate-700 shadow-sm font-medium hover:bg-white'
                            : 'text-slate-400 hover:text-slate-600',
                        )}
                        onClick={() => updateRole({ id, role: 'admin' })}
                      >
                        관리자
                      </Button>
                    </div>
                  </Activity>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleSelection(user)}
                    className="h-6 w-6 text-slate-400 hover:text-rose-500 hover:bg-transparent"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {selectedItems.size === 0 && (
            <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
              선택된 항목이 없습니다.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
