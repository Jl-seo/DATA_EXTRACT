import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { text, available_fields } = body;

        // Mock response
        const mockRules = [
            {
                "id": "rule_" + Date.now(),
                "original_text": text,
                "type": "custom_logic",
                "target_fields": available_fields || [],
                "action": "apply_transformation",
                "status": "parsed successfully"
            }
        ];

        // 네트워크 지연 모방
        await new Promise(resolve => setTimeout(resolve, 800));

        return NextResponse.json({ rules: mockRules });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to parse' }, { status: 500 });
    }
}
