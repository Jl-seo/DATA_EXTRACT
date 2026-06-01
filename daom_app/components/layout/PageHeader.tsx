import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-slate-500">{description}</p>
      )}
    </div>
  );
}
