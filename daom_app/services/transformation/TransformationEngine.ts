import 'server-only';

export interface TransformationRule {
    type: 'EXPLODE' | 'CALCULATE' | 'VALIDATE';
    config: any;
    enabled?: boolean;
}

export interface TransformationResult {
    original: any;
    processed: any;
    audit: any[];
}

export class TransformationEngine {

    public apply(data: any, rules: TransformationRule[]): TransformationResult {
        // Deep copy data to avoid mutating original
        let processedData = JSON.parse(JSON.stringify(data));

        const results: TransformationResult = {
            original: data,
            processed: processedData,
            audit: []
        };

        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            if (rule.enabled === false) continue;

            try {
                if (rule.type === 'EXPLODE') {
                    processedData = this.handleExplode(processedData, rule.config);
                } else if (rule.type === 'CALCULATE') {
                    processedData = this.handleCalculate(processedData, rule.config);
                } else if (rule.type === 'VALIDATE') {
                    processedData = this.handleValidate(processedData, rule.config);
                } else {
                    console.warn(`[Transformation] Unknown rule type: ${rule.type}`);
                    continue;
                }

                results.audit.push({
                    rule_index: i,
                    type: rule.type,
                    status: 'success'
                });
            } catch (error: any) {
                console.error(`[Transformation] Rule failed: ${rule.type} -`, error);
                results.audit.push({
                    rule_index: i,
                    type: rule.type,
                    status: 'failed',
                    error: String(error)
                });
            }
        }

        results.processed = processedData;
        return results;
    }

    private handleExplode(data: any, config: any): any {
        const sources: Array<{ field: string, as?: string }> = config.sources || [];
        const outputField: string = config.output_field || "Exploded_List";
        const preserveFields: string[] = config.preserve_fields || [];

        const listValues: any[][] = [];
        const keys: string[] = [];

        for (const src of sources) {
            const fname = src.field;
            const alias = src.as || fname;
            let val = data[fname];

            if (!Array.isArray(val)) {
                val = val == null ? [] : [val];
            }

            listValues.push(val);
            keys.push(alias);
        }

        // Cartesian product
        const cartesian = (arrays: any[][]) => arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())), [[]] as any[]);
        let combinations: any[][] = [];
        if (listValues.length > 0) {
            combinations = cartesian(listValues);
        }

        const resultRows: any[] = [];
        for (const combo of combinations) {
            const row: any = {};
            for (let i = 0; i < keys.length; i++) {
                row[keys[i]] = combo[i];
            }
            for (const pf of preserveFields) {
                if (data[pf] !== undefined) {
                    row[pf] = data[pf];
                }
            }
            resultRows.push(row);
        }

        data[outputField] = resultRows;
        return data;
    }

    private safeEval(expr: string, context: any): any {
        try {
            const argNames = Object.keys(context);
            const argValues = Object.values(context);
            // Use Function to evaluate expression within context
            // Note: In strict environments this could be replaced by a safe math parser like mathjs
            const func = new Function(...argNames, `return (${expr});`);
            return func(...argValues);
        } catch (e) {
            console.warn(`Safe eval failed: ${expr}`, e);
            return null;
        }
    }

    private handleCalculate(data: any, config: any): any {
        const targetList = config.target_list;
        const calcs = config.calculations || [];

        if (targetList) {
            const rows = data[targetList];
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const context = { ...data, ...row };
                    for (const calc of calcs) {
                        const condition = calc.condition || "true";
                        if (this.safeEval(condition, context)) {
                            const result = this.safeEval(calc.expression, context);
                            if (result !== null && result !== undefined) {
                                row[calc.field] = result;
                            }
                        }
                    }
                }
            }
        } else {
            for (const calc of calcs) {
                const condition = calc.condition || "true";
                if (this.safeEval(condition, data)) {
                    const result = this.safeEval(calc.expression, data);
                    if (result !== null && result !== undefined) {
                        data[calc.field] = result;
                    }
                }
            }
        }
        return data;
    }

    private handleValidate(data: any, config: any): any {
        const checkExpr = config.check;
        const severity = config.severity || "warning";
        const message = config.message || "Validation failed";

        if (checkExpr) {
            // Provide a basic 'len' function in context
            const context = { ...data, len: (x: any) => (x ? (x.length || 0) : 0) };
            if (!this.safeEval(checkExpr, context)) {
                console.warn(`Validation failed: ${checkExpr}`);
                if (!Array.isArray(data.validation_errors)) {
                    data.validation_errors = [];
                }
                data.validation_errors.push({
                    severity,
                    message,
                    check: checkExpr
                });
            }
        }

        return data;
    }
}
