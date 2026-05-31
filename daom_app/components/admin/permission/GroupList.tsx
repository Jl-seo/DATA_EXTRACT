'use client';

import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { cn } from '@/lib/utils';
import { buildAdminEntraIDGroupListInfiniteQuery } from '@/queries/entraId';
import { GroupType } from '@/scheme/entraId';
import { ScrollArea } from '@/components/ui/scroll-area'; // Changed import
import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, Users } from 'lucide-react';
import { GlobalPermissionSelectedUser } from '@/scheme/permission';
import { Spinner } from '@/components/ui/spinner';
import { memo } from 'react';

export const GroupList = memo(function GroupList({
  searchText,
  selectedItems,
  toggleSelection,
  groupType,
  className,
}: {
  searchText: string;
  selectedItems: Map<string, GlobalPermissionSelectedUser>;
  toggleSelection: (group: GlobalPermissionSelectedUser) => void;
  groupType: GroupType;
  className?: string;
}) {
  const {
    data: groupData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery(
    buildAdminEntraIDGroupListInfiniteQuery({
      search: searchText,
      groupType: groupType,
    }),
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
        {(groupData?.pages ?? []).map((page) =>
          page?.value?.map((group) => {
            const isSelected = selectedItems.has(group.id);
            let groupTypeText: 'M365' | 'Security' | undefined = undefined;
            if (group.groupTypes.includes('Unified')) {
              groupTypeText = 'M365';
            } else if (!group.mailEnabled && !!group.securityEnabled) {
              groupTypeText = 'Security';
            }
            const groupWithRole: GlobalPermissionSelectedUser = {
              target: {
                object_id: group.id,
                name: group.displayName,
                upn: group.mail ?? undefined,
              },
              role: 'user',
              target_type:
                `${groupTypeText ? `group:${groupTypeText}` : 'group'}` as GlobalPermissionSelectedUser['target_type'],
            };
            return (
              <div
                key={group.id}
                className={cn(
                  'flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer transition-colors',
                  isSelected && 'bg-sky-50 hover:bg-sky-100',
                )}
                onClick={() => toggleSelection(groupWithRole)}
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
                  <Users className="w-4 h-4" />
                </div>

                <div className="flex flex-col w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {group.displayName}
                    </span>
                    {groupTypeText && (
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0',
                          groupTypeText === 'M365'
                            ? 'bg-sky-100 text-sky-600'
                            : 'bg-indigo-100 text-indigo-600',
                        )}
                      >
                        {groupTypeText}
                      </span>
                    )}
                  </div>
                  {group.mail && (
                    <span className="text-sm text-slate-500 truncate">
                      {group.mail}
                    </span>
                  )}
                </div>
              </div>
            );
          }),
        )}
        {!isFetching && (groupData?.pages?.[0]?.value ?? []).length == 0 && (
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
