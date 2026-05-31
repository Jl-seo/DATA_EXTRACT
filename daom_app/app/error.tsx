'use client';

import { useEffect } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Global Error Boundary caught:', error);
    }, [error]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="max-w-md w-full text-center">
                <div className="w-16 h-16 mx-auto mb-6 bg-destructive/10 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>

                <h1 className="text-2xl font-bold text-foreground mb-2">
                    문제가 발생했습니다
                </h1>

                <p className="text-muted-foreground mb-6">
                    페이지를 표시하는 중 오류가 발생했습니다. 다시 시도하거나 홈으로
                    이동해주세요.
                </p>

                {process.env.NODE_ENV === 'development' && (
                    <details className="mb-6 text-left">
                        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                            개발자 정보 보기
                        </summary>
                        <div className="mt-2 p-4 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-48">
                            <div className="text-destructive font-bold mb-2">
                                {error.message}
                            </div>
                            {error.stack && (
                                <pre className="whitespace-pre-wrap text-muted-foreground">
                                    {error.stack}
                                </pre>
                            )}
                        </div>
                    </details>
                )}

                <div className="flex gap-3 justify-center">
                    <Button
                        variant="outline"
                        onClick={() => reset()}
                        className="gap-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        다시 시도
                    </Button>
                    <Button onClick={() => (window.location.href = '/')} className="gap-2">
                        <Home className="w-4 h-4" />
                        홈으로 이동
                    </Button>
                </div>
            </div>
        </div>
    );
}
