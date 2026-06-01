import { NextResponse } from 'next/server';
import { runStartupTasks } from '@/lib/startup';

/**
 * Initialization API Route
 * GET /api/init - Run startup tasks manually
 */
export async function GET() {
    try {
        const result = await runStartupTasks();

        if (result.success) {
            return NextResponse.json({
                success: true,
                message: result.message,
            });
        } else {
            return NextResponse.json({
                success: false,
                message: result.message,
            }, { status: 500 });
        }
    } catch (error) {
        return NextResponse.json({
            success: false,
            message: `Initialization failed: ${error}`,
        }, { status: 500 });
    }
}
