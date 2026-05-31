'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Search, RotateCcw, Sliders, Trash2 } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { globalPermissionSearchParamParsers } from '@/app/(authenticated)/admin/permissions/searchParams';
import { debounce } from '@/utils/debounce';
import { useMemo, useState, memo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface PermissionFilterProps {
  selectedCount: number;
  onBulkDelete: () => void;
}

export const PermissionFilter = memo(function PermissionFilter({
  selectedCount,
  onBulkDelete,
}: PermissionFilterProps) {
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const nameOrUpnRef = useRef<HTMLInputElement>(null);

  const [params, setParams] = useQueryStates(
    globalPermissionSearchParamParsers,
    {
      shallow: false,
    },
  );

  const setParamsWithDebounce = useMemo(
    () => debounce(setParams, 250),
    [setParams],
  );

  useEffect(() => {
    if (params.nameOrUpn && nameOrUpnRef.current) {
      nameOrUpnRef.current.value = params.nameOrUpn;
    }
  }, [params.nameOrUpn]);

  const handleReset = () => {
    if (nameOrUpnRef.current) {
      nameOrUpnRef.current.value = '';
    }
    setParamsWithDebounce({
      ...params,
      offset: 0,
      nameOrUpn: '',
      role: 'all',
    });
    setRoleFilter('all');
  };

  return (
    <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-wrap gap-3 items-center">
      <div className="flex items-center gap-2">
        <Sliders className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-bold text-slate-600">필터</span>
      </div>

      <div className="h-4 w-px bg-slate-200 mx-1" />

      <div className="relative w-50">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input
          ref={nameOrUpnRef}
          placeholder="이름 또는 이메일 검색"
          onChange={(e) => {
            setParamsWithDebounce({
              ...params,
              nameOrUpn: e.target.value,
            });
          }}
          className="pl-8 h-8 text-sm bg-slate-50 border-slate-200"
        />
      </div>

      <Combobox
        value={roleFilter}
        onValueChange={(value) => {
          const role = value as 'all' | 'admin' | 'user';
          setRoleFilter(role);
          setParams({
            ...params,
            role: role,
          });
        }}
        options={[
          { value: 'all', label: '전체' },
          { value: 'admin', label: '관리자' },
          { value: 'user', label: '사용자' },
        ]}
        placeholder="권한"
        triggerClassName="w-32.5 h-8 text-sm bg-slate-50 border-slate-200"
      />

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleReset();
          }}
          className="h-8 text-sm text-slate-500 hover:text-sky-600"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          초기화
        </Button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        <Button
          variant={selectedCount === 0 ? 'outline' : 'destructive'}
          size="sm"
          disabled={selectedCount === 0}
          onClick={(e) => {
            e.stopPropagation();
            onBulkDelete();
          }}
          className={cn(
            'h-8 text-sm gap-1.5 rounded-lg shadow-sm transition-all',
            selectedCount === 0
              ? 'bg-slate-100 text-slate-400 border-slate-200'
              : '',
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
          선택 삭제 ({selectedCount})
        </Button>
      </div>
    </div>
  );
});
