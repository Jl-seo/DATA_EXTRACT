'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Activity } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  children?: React.ReactNode; // Custom trigger content if needed
  showSearch?: boolean;
  triggerIcon?: React.ReactNode;
  multiple?: boolean;
  selectedValues?: string[];
  excludeBadgeValues?: string[];
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = '선택하세요...',
  emptyMessage = '결과가 없습니다.',
  searchPlaceholder = '검색...',
  className,
  triggerClassName,
  disabled,
  children,
  showSearch = false,
  triggerIcon = <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />,
  multiple = false,
  selectedValues = [],
  excludeBadgeValues = [],
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const selectedBadges = React.useMemo(() => {
    if (!multiple || selectedValues.length === 0) return null;

    const displayValues = selectedValues.filter(
      (val) => !excludeBadgeValues.includes(val),
    );
    if (displayValues.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50/30 max-h-[120px] overflow-y-auto">
        {displayValues.map((val) => {
          const opt = options.find((o) => o.value === val);
          return (
            <Badge
              key={val}
              variant="secondary"
              className="pl-2 pr-1 py-0 h-6 bg-white border-slate-200 text-slate-600 gap-1 hover:bg-white flex items-center shadow-sm shrink-0"
            >
              <span className="text-xs font-medium">{opt?.label || val}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange(val);
                }}
                className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-rose-500 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </Badge>
          );
        })}
      </div>
    );
  }, [multiple, selectedValues, excludeBadgeValues, options, onValueChange]);

  if (!mounted) {
    return (
      <Button
        variant="outline"
        role="combobox"
        disabled={disabled}
        className={cn('w-full justify-between items-center', triggerClassName)}
      >
        {children ? (
          <div className="flex items-center gap-2 truncate">
            {children}
            {selectedOption?.label || placeholder}
          </div>
        ) : (
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
        )}
        {triggerIcon}
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between items-center',
            triggerClassName,
          )}
        >
          {children ? (
            <div className="flex items-center gap-2 truncate">
              {children}
              {selectedOption?.label || placeholder}
            </div>
          ) : (
            <span className="truncate">
              {selectedOption?.label || placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 w-[var(--radix-popover-trigger-width)]', className)}
      >
        <Command>
          <Activity mode={showSearch ? 'visible' : 'hidden'}>
            <CommandInput placeholder={searchPlaceholder} className="h-9" />
          </Activity>
          {selectedBadges}
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={(currentValue) => {
                    if (multiple) {
                      onValueChange(currentValue);
                      // Don't close popover in multiple mode
                    } else {
                      onValueChange(currentValue === value ? '' : currentValue);
                      setOpen(false);
                    }
                  }}
                >
                  {option.label}
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4',
                      multiple
                        ? selectedValues.includes(option.value)
                          ? 'opacity-100'
                          : 'opacity-0'
                        : value === option.value
                          ? 'opacity-100'
                          : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
