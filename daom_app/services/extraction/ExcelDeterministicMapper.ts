import 'server-only';

export type ExcelSubField = {
    key: string;
    label?: string | null;
    type?: string | null;
};

export type ExcelColumnMapping = {
    subFieldKey: string;
    subFieldLabel: string;
    columnIndex: number;
    columnLetter: string;
    headerSignature: string;
    score: number;
};

type ColumnProfile = {
    columnIndex: number;
    columnLetter: string;
    headerSignature: string;
    headerTokens: Set<string>;
};

type MappingCandidate = {
    subFieldKey: string;
    subFieldLabel: string;
    columnIndex: number;
    score: number;
};

export type ExcelDeterministicMapResult = {
    subFieldToColumnIndex: Map<string, number>;
    mappings: ExcelColumnMapping[];
};

export class ExcelDeterministicMapper {
    private static normalizeToken(value: unknown): string {
        if (value === null || value === undefined) return '';
        return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    private static toColumnLetter(columnIndex: number): string {
        let label = '';
        let temp = columnIndex;
        while (temp >= 0) {
            label = String.fromCharCode((temp % 26) + 65) + label;
            temp = Math.floor(temp / 26) - 1;
        }
        return label;
    }

    private static buildCandidateTokens(subField: ExcelSubField): string[] {
        const tokens: string[] = [];
        const keyToken = this.normalizeToken(subField.key);
        if (keyToken) tokens.push(keyToken);

        const labelToken = this.normalizeToken(subField.label || '');
        if (labelToken) tokens.push(labelToken);

        const splitByUnderscore = subField.key.split('_')
            .map(part => this.normalizeToken(part))
            .filter(part => part.length >= 2);
        tokens.push(...splitByUnderscore);

        const uniq = Array.from(new Set(tokens));
        return uniq.sort((a, b) => b.length - a.length);
    }

    private static buildColumnProfiles(
        sheetRows: unknown[][],
        validColIndices: number[],
        headerRowLimit: number
    ): ColumnProfile[] {
        const headerRows = sheetRows.slice(0, Math.min(sheetRows.length, headerRowLimit));

        return validColIndices.map((colIdx) => {
            const fragments: string[] = [];
            const tokenSet = new Set<string>();

            let lastVerticalValue = '';
            for (const row of headerRows) {
                let raw = row?.[colIdx];
                let text = (raw === null || raw === undefined) ? '' : String(raw).trim();

                if (!text) {
                    text = lastVerticalValue;
                } else {
                    lastVerticalValue = text;
                }

                const token = this.normalizeToken(text);
                if (!token) continue;
                tokenSet.add(token);
                if (!fragments.includes(text)) fragments.push(text);
            }

            const headerSignature = fragments.join(' > ');
            return {
                columnIndex: colIdx,
                columnLetter: this.toColumnLetter(colIdx),
                headerSignature,
                headerTokens: tokenSet
            };
        });
    }

    static mapSubFieldsToColumns(params: {
        sheetRows: unknown[][];
        validColIndices: number[];
        subFields: ExcelSubField[];
        headerRowLimit?: number;
        minScore?: number;
    }): ExcelDeterministicMapResult {
        const headerRowLimit = params.headerRowLimit ?? 20;
        const minScore = params.minScore ?? 60;
        const profiles = this.buildColumnProfiles(params.sheetRows, params.validColIndices, headerRowLimit);

        const allCandidates: MappingCandidate[] = [];

        for (const subField of params.subFields) {
            const tokens = this.buildCandidateTokens(subField);
            if (tokens.length === 0) continue;

            for (const profile of profiles) {
                let score = 0;
                const signatureToken = this.normalizeToken(profile.headerSignature);

                for (const token of tokens) {
                    if (!token) continue;
                    if (profile.headerTokens.has(token)) {
                        score = Math.max(score, 120);
                    }
                    for (const headerToken of profile.headerTokens) {
                        if (headerToken.includes(token) || token.includes(headerToken)) {
                            score = Math.max(score, 90);
                        }
                    }
                    if (signatureToken && (signatureToken.includes(token) || token.includes(signatureToken))) {
                        score = Math.max(score, 75);
                    }
                }

                if (score > 0) {
                    allCandidates.push({
                        subFieldKey: subField.key,
                        subFieldLabel: subField.label || subField.key,
                        columnIndex: profile.columnIndex,
                        score
                    });
                }
            }
        }

        allCandidates.sort((a, b) => b.score - a.score);

        const usedSubFields = new Set<string>();
        const usedColumns = new Set<number>();
        const subFieldToColumnIndex = new Map<string, number>();
        const mappings: ExcelColumnMapping[] = [];

        for (const candidate of allCandidates) {
            if (candidate.score < minScore) continue;
            if (usedSubFields.has(candidate.subFieldKey)) continue;
            if (usedColumns.has(candidate.columnIndex)) continue;

            const profile = profiles.find(p => p.columnIndex === candidate.columnIndex);
            if (!profile) continue;

            usedSubFields.add(candidate.subFieldKey);
            usedColumns.add(candidate.columnIndex);
            subFieldToColumnIndex.set(candidate.subFieldKey, candidate.columnIndex);
            mappings.push({
                subFieldKey: candidate.subFieldKey,
                subFieldLabel: candidate.subFieldLabel,
                columnIndex: candidate.columnIndex,
                columnLetter: profile.columnLetter,
                headerSignature: profile.headerSignature,
                score: candidate.score
            });
        }

        return { subFieldToColumnIndex, mappings };
    }
}

