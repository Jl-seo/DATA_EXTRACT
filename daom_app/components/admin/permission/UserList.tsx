'use client';

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { cn } from '@/lib/utils';
import { buildAdminEntraIDUserListInfiniteQuery } from '@/queries/entraId';
import { ScrollArea } from '@/components/ui/scroll-area'; // Changed import
import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, User } from 'lucide-react';
import { GlobalPermissionSelectedUser } from '@/scheme/permission';
import { Spinner } from '@/components/ui/spinner';
import { memo } from 'react';

export const UserList = memo(function UserList({
  searchText,
  selectedItems,
  toggleSelection,
  className,
}: {
  searchText: string;
  selectedItems: Map<string, GlobalPermissionSelectedUser>;
  toggleSelection: (user: GlobalPermissionSelectedUser) => void;
  className?: string;
}) {
  const {
    data: userData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery(
    buildAdminEntraIDUserListInfiniteQuery({ search: searchText }),
  );

  const loadMoreRef = useIntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    { threshold: 1.0 },
  );

  return (
    <ScrollArea
      className={cn('mt-4 border border-slate-200 rounded-lg', className)}
    >
      <div className="divide-y divide-slate-100">
        {(userData?.pages ?? []).map((page) =>
          page?.value?.map((user) => {
            const isSelected = selectedItems.has(user.id);
            const userWithRole: GlobalPermissionSelectedUser = {
              target: {
                object_id: user.id,
                name: user.displayName,
                upn: user.userPrincipalName,
              },
              role: 'user',
              target_type: 'user',
            };
            return (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer transition-colors',
                  isSelected && 'bg-sky-50 hover:bg-sky-100',
                )}
                onClick={() => toggleSelection(userWithRole)}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center shrink-0',
                    isSelected
                      ? 'bg-sky-600 border-sky-600'
                      : 'border-slate-300 bg-white',
                  )}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </div>

                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 shrink-0">
                  <User className="w-4 h-4" />
                </div>

                <div className="flex flex-col w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800 truncate">
                    {user.displayName}
                  </span>
                  <span className="text-sm text-slate-500 truncate">
                    {user.userPrincipalName}
                  </span>
                </div>
              </div>
            );
          }),
        )}
        {!isFetching && (userData?.pages?.[0]?.value ?? []).length == 0 && (
          <div className="p-8 text-center text-sm text-neutral-500">
            검색 결과가 없습니다
          </div>
        )}
      </div>
      <div className="h-1" ref={loadMoreRef} />
      {(isFetchingNextPage || isFetching) && (
        <div className="flex w-full items-center justify-center py-6">
          <Spinner />
        </div>
      )}
    </ScrollArea>
  );
});
