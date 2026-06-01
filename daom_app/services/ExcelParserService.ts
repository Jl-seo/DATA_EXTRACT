import 'server-only';
import * as xlsx from 'xlsx';

export interface ExcelParseResult {
    content: string; // UI 표시용 마크다운 문자열
    sheetNames: string[];
    rawData?: Record<string, any[]>; // SheetName -> 객체 배열 (헤더를 key로 사용, __EMPTY_ 키 포함 가능)
    rawMatrix?: Record<string, any[][]>; // SheetName -> 배열 모드(header:1) 원본 행렬 - UI 마크다운과 동일한 소스
    _error?: string;
}

export class ExcelParserService {
    /**
     * Parse an Excel file buffer into a structured and stringified JSON format
     * suitable for LLM consumption.
     * @param buffer The excel file buffer
     */
    async parse(buffer: Buffer): Promise<ExcelParseResult> {
        try {
            // Read the Excel workbook from the buffer
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            
            const sheetNames = workbook.SheetNames;
            const rawData: Record<string, any[]> = {};
            const rawMatrix: Record<string, any[][]> = {};
            let mergedContent = '';

            for (const sheetName of sheetNames) {
                const sheet = workbook.Sheets[sheetName];
                // header:1 모드: 모든 셀을 배열로 반환 → UI 마크다운 생성 및 LLM 컨텍스트에 사용
                const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
                rawMatrix[sheetName] = rows; // 배열 모드 원본 저장

                // 객체 모드 (하위 호환성 유지)
                const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: '' });
                rawData[sheetName] = jsonData;

                if (rows.length > 0) {
                    // 1. Identify valid columns (columns that have at least one value)
                    const maxCols = Math.max(...rows.map(r => r.length));
                    const validColIndices: number[] = [];
                    for (let c = 0; c < maxCols; c++) {
                        const isColEmpty = rows.every(r => r[c] === undefined || r[c] === '');
                        if (!isColEmpty) {
                            validColIndices.push(c);
                        }
                    }

                    // 2. Filter out valid rows (rows with at least one non-empty cell)
                    const validRows = rows.filter(r => r.some(cell => cell !== undefined && cell !== ''));
                    
                    if (validRows.length > 0 && validColIndices.length > 0) {
                        // Headers: Row index and Column letters (A, B, C...)
                        const colLetters = validColIndices.map(c => {
                            let label = '';
                            let temp = c;
                            while (temp >= 0) {
                                label = String.fromCharCode((temp % 26) + 65) + label;
                                temp = Math.floor(temp / 26) - 1;
                            }
                            return label;
                        });

                        let markdown = `\n### Sheet: ${sheetName}\n\n`;
                        markdown += `| Row | ${colLetters.join(' | ')} |\n`;
                        markdown += `| --- | ${colLetters.map(() => '---').join(' | ')} |\n`;
                        
                        // Limit to 1000 rows for performance
                        const rowsToDisplay = rows.slice(0, 1000);
                        
                        rowsToDisplay.forEach((row, rowIndex) => {
                            const isRowEmpty = validColIndices.every(c => row[c] === undefined || row[c] === '');
                            if (isRowEmpty) return; // Skip empty rows during display

                            const cells = validColIndices.map(c => {
                                const val = row[c];
                                return String(val ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
                            });
                            markdown += `| ${rowIndex} | ${cells.join(' | ')} |\n`;
                        });
                        
                        if (rows.length > 1000) {
                            markdown += `\n*...and ${rows.length - 1000} more rows truncated for preview*\n`;
                        }
                        
                        mergedContent += markdown + '\n';
                    } else {
                        mergedContent += `\n### Sheet: ${sheetName}\n\n(Empty Sheet)\n`;
                    }
                } else {
                    mergedContent += `\n### Sheet: ${sheetName}\n\n(Empty Sheet)\n`;
                }
            }

            return {
                content: mergedContent.trim(),
                sheetNames,
                rawData,
                rawMatrix
            };

        } catch (error: any) {
            console.error('[ExcelParser] Error parsing excel file:', error);
            throw new Error(`Failed to parse Excel file: ${error.message}`);
        }
    }
}
