'use client';

import { useState, useMemo } from 'react';
import { ComparisonResult, Difference } from '@/scheme/comparison';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Target, Type, Layout, Palette, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComparisonViewerProps {
    baselineUrl: string;
    candidateUrl: string;
    result: ComparisonResult;
}

export function ComparisonViewer({ baselineUrl, candidateUrl, result }: ComparisonViewerProps) {
    const [selectedDiffId, setSelectedDiffId] = useState<number | null>(null);

    const differences = result.differences || [];
    const error = result.error;

    if (error) {
        return (
            <Alert variant="destructive" className="m-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="flex h-full max-h-[calc(100vh-200px)]">
            {/* Left Panel: Difference List */}
            <div className="w-1/3 min-w-[320px] max-w-[400px] border-r flex flex-col bg-muted/10">
                <div className="p-4 border-b bg-background">
                    <h2 className="font-semibold text-lg flex items-center gap-2">
                        Differences
                        <Badge variant="secondary">{differences.length}</Badge>
                    </h2>
                </div>
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-3">
                        {differences.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                No differences detected.
                            </div>
                        ) : (
                            differences.map((diff) => (
                                <DifferenceCard
                                    key={diff.id}
                                    diff={diff}
                                    isSelected={selectedDiffId === diff.id}
                                    onClick={() => setSelectedDiffId(diff.id)}
                                />
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Right Panel: Image Display */}
            <div className="flex-1 bg-slate-50 relative overflow-hidden flex flex-col">
                <div className="flex-1 grid grid-cols-2 gap-4 p-4 h-full overflow-auto">
                    <ImageViewer
                        title="Baseline"
                        url={baselineUrl}
                        differences={differences}
                        selectedDiffId={selectedDiffId}
                        type="baseline"
                    />
                    <ImageViewer
                        title="Candidate"
                        url={candidateUrl}
                        differences={differences}
                        selectedDiffId={selectedDiffId}
                        type="candidate"
                    />
                </div>
            </div>
        </div>
    );
}

function DifferenceCard({ diff, isSelected, onClick }: { diff: Difference, isSelected: boolean, onClick: () => void }) {
    const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
        content: Type,
        layout: Layout,
        style: Palette,
        added_element: Plus,
        missing_element: Minus
    };
    const Icon = iconMap[diff.category] || Target;

    return (
        <div
            onClick={onClick}
            className={cn(
                "p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md",
                isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card border-border hover:border-primary/50"
            )}
        >
            <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className={cn(
                    "capitalize flex gap-1 items-center",
                    getMethodColor(diff.category)
                )}>
                    <Icon className="w-3 h-3" />
                    {diff.category.replace('_', ' ')}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">ID: {diff.id}</span>
            </div>
            <p className="text-sm font-medium leading-relaxed">
                {diff.description}
            </p>
        </div>
    );
}

function getMethodColor(category: string) {
    switch (category) {
        case 'content': return "text-blue-600 border-blue-200 bg-blue-50";
        case 'layout': return "text-orange-600 border-orange-200 bg-orange-50";
        case 'style': return "text-purple-600 border-purple-200 bg-purple-50";
        case 'missing_element': return "text-red-600 border-red-200 bg-red-50";
        case 'added_element': return "text-green-600 border-green-200 bg-green-50";
        default: return "";
    }
}

function ImageViewer({ title, url, differences, selectedDiffId, type }: {
    title: string,
    url: string,
    differences: Difference[],
    selectedDiffId: number | null,
    type: 'baseline' | 'candidate'
}) {
    return (
        <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="p-2 bg-muted/30 border-b text-center font-medium text-sm text-muted-foreground">
                {title}
            </div>
            <div className="flex-1 relative overflow-auto p-4 flex items-center justify-center">
                <div className="relative inline-block shadow-lg">
                    {/* Image */}
                    <img src={url} alt={title} className="max-w-full max-h-full object-contain block" />

                    {/* Overlay Bounding Boxes */}
                    <div className="absolute inset-0 pointer-events-none">
                        {differences.map(diff => {
                            const loc = type === 'baseline' ? diff.location_1 : diff.location_2;
                            if (!loc) return null;

                            const [ymin, xmin, ymax, xmax] = loc;
                            // Normalize 0-1000 to Percentage
                            const top = ymin / 10;
                            const left = xmin / 10;
                            const width = (xmax - xmin) / 10;
                            const height = (ymax - ymin) / 10;

                            const isSelected = selectedDiffId === diff.id;

                            return (
                                <div
                                    key={diff.id}
                                    className={cn(
                                        "absolute border-2 transition-all duration-200",
                                        isSelected ? "border-primary bg-primary/20 z-10" : "border-red-500/50 hover:bg-red-500/10"
                                    )}
                                    style={{
                                        top: `${top}%`,
                                        left: `${left}%`,
                                        width: `${width}%`,
                                        height: `${height}%`,
                                    }}
                                >
                                    {isSelected && (
                                        <span className="absolute -top-6 left-0 bg-primary text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                                            #{diff.id}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
