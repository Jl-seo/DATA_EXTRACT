export interface TableBatchExecutionPlan {
    batchIndex: number;
    shouldUseEnhancedContext: boolean;
}

export interface TableBatchExecutionGroup {
    mode: 'parallel' | 'sequential';
    batchIndexes: number[];
}

export function buildTableBatchExecutionGroups(
    plans: TableBatchExecutionPlan[]
): TableBatchExecutionGroup[] {
    const groups: TableBatchExecutionGroup[] = [];
    let pendingLegacy: number[] = [];

    const flushLegacy = () => {
        if (pendingLegacy.length === 0) return;
        groups.push({
            mode: 'parallel',
            batchIndexes: pendingLegacy,
        });
        pendingLegacy = [];
    };

    for (const plan of plans) {
        if (plan.shouldUseEnhancedContext) {
            flushLegacy();
            groups.push({
                mode: 'sequential',
                batchIndexes: [plan.batchIndex],
            });
            continue;
        }

        pendingLegacy.push(plan.batchIndex);
    }

    flushLegacy();
    return groups;
}
