type TableBatchField = {
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'table';
    description?: string | null;
    rules?: string | null;
    is_required?: boolean | null;
    sub_fields?: TableBatchField[] | null;
};

type HeaderSource = 'direct' | 'carried' | 'none';

const TABLE_ADJACENT_FIELD_KEYWORDS = [
    'valid',
    'date',
    'surcharge',
    'remark',
    'note',
    'included',
    'excluded',
];

const TABLE_GLOBAL_RULE_TAG_ALLOWLIST = [
    'core_objective',
    'decision_order',
    'table_role_rules',
    'atomic_row_rules',
    'header_and_axis_detection_rules',
    'split_and_normalization_rules',
    's_term_mapping_rules',
    'rate_type_rules',
    'surcharge_and_remark_rules',
    'reference_data_rules',
    'verification_rules',
    'north_america_final_table_rules',
    'carrier_special_cases',
];

const REFERENCE_DATA_KEY_PRIORITY = [
    'unique_constraints',
    'route_pod_mapping',
    'carrier_route_surcharge_hints',
    'carrier_surcharge_aliases',
    'surcharge_catalog',
] as const;

function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenizeForMatch(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^a-z0-9가-힣]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function buildTokenSet(values: string[]): Set<string> {
    const tokens = new Set<string>();
    values.forEach((value) => {
        tokenizeForMatch(value).forEach((token) => tokens.add(token));
        const normalized = normalizeForMatch(value);
        if (normalized.length >= 2) tokens.add(normalized);
    });
    return tokens;
}

function parseTableContextHeaders(tableContext?: string): string[] {
    if (!tableContext || !tableContext.trim()) return [];

    try {
        const parsed = JSON.parse(tableContext);
        const slices = Array.isArray(parsed) ? parsed : [];
        const headers = new Set<string>();

        slices.forEach((slice) => {
            if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return;
            const sliceRecord = slice as Record<string, unknown>;
            const cells = Array.isArray(sliceRecord.cells)
                ? (sliceRecord.cells as unknown[])
                : [];

            cells.forEach((cell: unknown) => {
                if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return;
                const cellRecord = cell as Record<string, unknown>;
                if (cellRecord.is_header !== true && cellRecord.carried_header !== true) return;
                if (typeof cellRecord.content !== 'string' || cellRecord.content.trim().length === 0) return;
                headers.add(cellRecord.content.trim());
            });
        });

        return [...headers];
    } catch {
        return [];
    }
}

function collectFieldTexts(field: TableBatchField): string[] {
    const texts = [
        field.key,
        field.label,
        field.description || '',
        field.rules || '',
    ];

    (field.sub_fields || []).forEach((subField) => {
        texts.push(
            subField.key,
            subField.label,
            subField.description || '',
            subField.rules || '',
        );
    });

    return texts.filter((text) => text.trim().length > 0);
}

function buildSubFieldHeaderAliases(field: TableBatchField): string[] {
    return [
        field.key,
        field.label,
        field.description || '',
    ]
        .map((value) => normalizeForMatch(value))
        .filter((value) => value.length >= 4);
}

function countMatchedSubFields(field: TableBatchField, headerTexts: string[]): number {
    const subFields = field.sub_fields || [];
    if (subFields.length === 0 || headerTexts.length === 0) return 0;

    const normalizedHeaders = headerTexts
        .map((header) => normalizeForMatch(header))
        .filter((header) => header.length > 0);

    return subFields.reduce((count, subField) => {
        const aliases = buildSubFieldHeaderAliases(subField);
        if (aliases.length === 0) return count;

        const matched = aliases.some((alias) =>
            normalizedHeaders.some((header) => header.includes(alias) || alias.includes(header))
        );

        return matched ? count + 1 : count;
    }, 0);
}

function scoreTableFieldForBatch(
    field: TableBatchField,
    params: {
        headerTexts: string[];
        chunkContent?: string;
        headerSource?: HeaderSource;
    },
): number {
    const subFieldCount = field.sub_fields?.length || 0;
    const matchedSubFields = countMatchedSubFields(field, params.headerTexts);
    const fieldTokens = buildTokenSet(collectFieldTexts(field));
    const contextTokens = buildTokenSet([params.chunkContent || '', ...params.headerTexts]);
    let contextMatches = 0;

    fieldTokens.forEach((token) => {
        if (contextTokens.has(token)) contextMatches += 1;
    });

    let score = matchedSubFields * 4;
    score += Math.min(contextMatches, 3);

    if (subFieldCount > 0 && matchedSubFields === 0) {
        score -= 3;
    }

    if (params.headerSource === 'none' && matchedSubFields === 0) {
        score -= 2;
    }

    return score;
}

function isTableAdjacentField(field: TableBatchField): boolean {
    if (field.type === 'table') return true;

    const haystack = normalizeForMatch([
        field.key,
        field.label,
        field.description || '',
        field.rules || '',
    ].join(' '));

    return TABLE_ADJACENT_FIELD_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function buildCompactFieldDescription(field: TableBatchField): string {
    const flags: string[] = [];
    if (field.is_required) flags.push('REQUIRED');
    if (field.rules) flags.push(field.rules);

    if (field.type === 'table') {
        const subFields = (field.sub_fields || [])
            .map((subField) => {
                const subFlags: string[] = [];
                if (subField.is_required) subFlags.push('REQ');
                if (subField.rules) subFlags.push(subField.rules);
                return `${subField.key}:${subField.label}${subFlags.length > 0 ? ` [${subFlags.join('; ')}]` : ''}`;
            })
            .join(', ');

        return `- ${field.key} (table): ${field.label}${subFields ? ` | columns=${subFields}` : ''}${flags.length > 0 ? ` | rules=${flags.join('; ')}` : ''}`;
    }

    return `- ${field.key} (${field.type}): ${field.label}${flags.length > 0 ? ` | rules=${flags.join('; ')}` : ''}`;
}

function extractAllowedTaggedSections(globalRules: string): string {
    const sections = TABLE_GLOBAL_RULE_TAG_ALLOWLIST
        .map((tag) => {
            const match = globalRules.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
            return match ? `<${tag}>${match[1].trim()}</${tag}>` : null;
        })
        .filter((section): section is string => section !== null);

    if (sections.length === 0) {
        return globalRules.replace(/\s+/g, ' ').trim().slice(0, 6000);
    }

    return sections.join('\n').slice(0, 8000);
}

function buildSlimReferenceData(referenceData: Record<string, unknown> | null | undefined): string {
    if (!referenceData) return '';

    const retained: Record<string, unknown> = {};

    for (const key of REFERENCE_DATA_KEY_PRIORITY) {
        if (Object.prototype.hasOwnProperty.call(referenceData, key)) {
            retained[key] = referenceData[key];
        }
    }

    const minified = () => JSON.stringify(retained);
    if (minified().length <= 8000) return minified();

    delete retained.carrier_route_surcharge_hints;
    if (minified().length <= 8000) return minified();

    delete retained.carrier_surcharge_aliases;
    if (minified().length <= 8000) return minified();

    delete retained.surcharge_catalog;
    return minified();
}

export function selectTableBatchFields(fields: TableBatchField[]): TableBatchField[] {
    return fields.filter((field) => isTableAdjacentField(field));
}

function filterTableFieldsByBatchScore(
    fields: TableBatchField[],
    params: {
        tableContext?: string;
        chunkContent?: string;
        headerSource?: HeaderSource;
    },
): TableBatchField[] {
    const headerTexts = parseTableContextHeaders(params.tableContext);
    const scoredFields = fields
        .filter((field) => field.type === 'table')
        .map((field) => ({
            field,
            matchedSubFields: countMatchedSubFields(field, headerTexts),
            subFieldCount: field.sub_fields?.length || 0,
            score: scoreTableFieldForBatch(field, {
                headerTexts,
                chunkContent: params.chunkContent,
                headerSource: params.headerSource,
            }),
        }));

    if (headerTexts.length === 0 && !(params.chunkContent || '').trim()) {
        return fields;
    }

    if (scoredFields.length === 0) return fields;

    const hasAnyHeaderMatchedField = scoredFields.some((entry) => entry.matchedSubFields > 0);
    const retainedTableFieldKeys = new Set(
        scoredFields
            .filter((entry) => {
                if (hasAnyHeaderMatchedField) {
                    return entry.matchedSubFields > 0;
                }

                if (entry.subFieldCount > 0) {
                    return entry.score >= 4;
                }

                return entry.score >= 2;
            })
            .map((entry) => entry.field.key)
    );

    return fields.filter((field) => field.type !== 'table' || retainedTableFieldKeys.has(field.key));
}

export function buildTableBatchPromptParts(params: {
    fields: TableBatchField[];
    globalRules?: string | null;
    referenceData?: Record<string, unknown> | null;
    tableContext?: string;
    chunkContent?: string;
    headerSource?: HeaderSource;
}): {
    fieldDescriptions: string;
    globalRules: string;
    referenceDataJson: string;
} {
    const selectedFields = filterTableFieldsByBatchScore(
        selectTableBatchFields(params.fields),
        {
            tableContext: params.tableContext,
            chunkContent: params.chunkContent,
            headerSource: params.headerSource,
        }
    );
    const fieldDescriptions = selectedFields.map((field) => buildCompactFieldDescription(field)).join('\n');
    const globalRules = params.globalRules ? extractAllowedTaggedSections(params.globalRules) : '';
    const referenceDataJson = buildSlimReferenceData(params.referenceData);

    return {
        fieldDescriptions,
        globalRules,
        referenceDataJson,
    };
}
