export interface TableSchemaField {
    key: string;
}

const hasSchemaFields = (
    fields: TableSchemaField[] | null | undefined
): fields is TableSchemaField[] => {
    return Array.isArray(fields) && fields.length > 0;
};

export const resolveStrictTableColumnKeys = (
    fieldSubFields: TableSchemaField[] | null | undefined,
    valueSubFields: TableSchemaField[] | null | undefined
): string[] => {
    if (hasSchemaFields(fieldSubFields)) {
        return fieldSubFields.map((field) => field.key);
    }

    if (hasSchemaFields(valueSubFields)) {
        return valueSubFields.map((field) => field.key);
    }

    return [];
};

export const hasStrictTableSchema = (
    fieldSubFields: TableSchemaField[] | null | undefined,
    valueSubFields: TableSchemaField[] | null | undefined
): boolean => {
    return resolveStrictTableColumnKeys(fieldSubFields, valueSubFields).length > 0;
};
