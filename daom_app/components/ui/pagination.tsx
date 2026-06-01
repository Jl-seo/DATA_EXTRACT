"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { memo } from "react";

interface PaginationProps {
  totalItems: number;
  currentPage?: number;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}

export const Pagination = memo(function Pagination({
  totalItems,
  currentPage = 1,
  itemsPerPage = 10,
  onPageChange,
  className,
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className={cn("flex items-center justify-center px-2 pt-2 shrink-0 border-t border-slate-50 mt-auto", className)}>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-lg border-slate-200 disabled:opacity-50"
          disabled={currentPage <= 1}
          onClick={() => onPageChange?.(currentPage - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center">
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <Button
              key={page}
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 w-8 rounded-lg font-bold",
                currentPage === page ? "bg-sky-50 text-sky-600" : "text-slate-400 hover:text-slate-600"
              )}
              onClick={() => onPageChange?.(page)}
            >
              {page}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-lg border-slate-200"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange?.(currentPage + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});
