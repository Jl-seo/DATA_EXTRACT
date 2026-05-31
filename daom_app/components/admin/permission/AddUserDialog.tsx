'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GroupType } from '@/scheme/entraId';
import { GroupList } from './GroupList';
import { UserList } from './UserList';
import {
  GlobalPermissionSelectedUser,
  GlobalPermissionUpdateRoleRequest,
} from '@/scheme/permission';
import { SelectedUsers } from './SelectedUsers';
import { usePermission } from '@/hooks/usePermission';
import { debounce } from '@/utils/debounce';

interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddUserDialog({ open, onOpenChange }: AddUserDialogProps) {
  const [selectedTab, setSelectedTab] = useState('user');
  const [selectedGroupType, setSelectedGroupType] = useState<GroupType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<
    Map<string, GlobalPermissionSelectedUser>
  >(new Map());

  const { addPermissions } = usePermission();

  const setSearchQueryWithDebounce = useMemo(() => {
    return debounce(setSearchQuery, 250);
  }, [setSearchQuery]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedItems(new Map());
      setSearchQuery('');
      setSelectedTab('user');
      setSelectedGroupType('all');
    }
    onOpenChange(nextOpen);
  };

  const toggleSelection = (user: GlobalPermissionSelectedUser) => {
    const newMap = new Map(selectedItems);
    if (newMap.has(user.target.object_id)) {
      newMap.delete(user.target.object_id);
    } else {
      newMap.set(user.target.object_id, user);
    }
    setSelectedItems(newMap);
  };

  const updateRole = (req: GlobalPermissionUpdateRoleRequest) => {
    const newMap = new Map(selectedItems);
    const prev = newMap.get(req.id);

    if (!prev) return;

    newMap.set(req.id, {
      ...prev,
      role: req.role,
    });
    setSelectedItems(newMap);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 overflow-hidden flex flex-col h-150">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>사용자 추가</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel: Selection */}
          <div className="w-[55%] shrink-0 border-r border-slate-100 flex flex-col p-6 pt-0 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="사용자 또는 그룹 검색..."
                className="pl-9 h-10"
                onChange={(e) => setSearchQueryWithDebounce(e.target.value)}
              />
            </div>

            <Tabs
              value={selectedTab}
              onValueChange={setSelectedTab}
              className="w-full"
            >
              <TabsList className="grid w-40 grid-cols-2 h-9">
                <TabsTrigger value="user">사용자</TabsTrigger>
                <TabsTrigger value="group">그룹</TabsTrigger>
              </TabsList>

              {selectedTab === 'group' && (
                <div className="flex gap-2 mt-4 text-sm">
                  <span className="font-bold text-slate-600 mt-1">
                    그룹 유형
                  </span>
                  <div className="flex gap-1">
                    {['all', 'M365', 'Security'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedGroupType(cat as GroupType)}
                        className={cn(
                          'px-3 py-1 rounded-full text-sm font-medium border transition-colors',
                          selectedGroupType === cat
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
                        )}
                      >
                        {cat === 'all'
                          ? '모든 그룹'
                          : cat === 'M365'
                            ? 'M365'
                            : '보안그룹'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedTab === 'user' ? (
                <UserList
                  searchText={searchQuery}
                  selectedItems={selectedItems}
                  toggleSelection={toggleSelection}
                  className="max-h-80 min-h-80"
                />
              ) : (
                <GroupList
                  searchText={searchQuery}
                  selectedItems={selectedItems}
                  toggleSelection={toggleSelection}
                  groupType={selectedGroupType}
                  className="max-h-[270px] min-h-[270px]"
                />
              )}
            </Tabs>
          </div>

          {/* Right Panel: Selected Items */}
          <SelectedUsers
            selectedItems={selectedItems}
            toggleSelection={toggleSelection}
            updateRole={updateRole}
          />
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-white">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="h-10 px-6"
          >
            취소
          </Button>
          <Button
            onClick={() => {
              addPermissions(Array.from(selectedItems.values()));
              handleOpenChange(false);
            }}
            disabled={selectedItems.size === 0}
            className="bg-sky-600 hover:bg-sky-700 text-white h-10 px-6"
          >
            추가 ({selectedItems.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
