import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { rules, sample_data } = body;

        // Mock test response
        const resultData = { ...sample_data };
        if (resultData['POL'] === 'Incheon') {
            resultData['Base_Rate'] = (resultData['Base_Rate'] || 0) + 50;
        }

        // 네트워크 지연 모방
        await new Promise(resolve => setTimeout(resolve, 800));

        return NextResponse.json({
            result: [resultData],
            audit: [
                { type: "syntax_check", status: "success" },
                { type: "logic_apply", status: "success" },
                { type: "rule_" + (rules?.[0]?.type || 'unknown'), status: "success" }
            ]
        });
    } catch (error) {
        return NextResponse.json({ error: 'Test failed' }, { status: 500 });
    }
}
