"use client";

import { useState } from 'react';
import { FlaskConical, RefreshCw, CheckCircle2, XCircle, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { testLocalLlm } from '@/actions/llmTest';
import { LocalLlmTestResult } from '@/scheme/llmTest';

/**
 * 로컬/폐쇄망 LLM(OpenAI 호환: vLLM, Ollama, LM Studio 등) 연결 테스트 카드.
 * 쿠버네티스/인프라 변경 없이, 로컬에 띄운 LLM 엔드포인트를 입력해 바로 동작을 검증한다.
 */
export function LocalLlmTestCard() {
    const [baseUrl, setBaseUrl] = useState('http://localhost:8000/v1');
    const [model, setModel] = useState('upstage/SOLAR-10.7B-Instruct-v1.0');
    const [apiKey, setApiKey] = useState('');
    const [prompt, setPrompt] = useState('');
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<LocalLlmTestResult | null>(null);

    const handleTest = async () => {
        if (!baseUrl.trim() || !model.trim()) {
            toast.error('Base URL과 모델명을 입력하세요');
            return;
        }
        setTesting(true);
        setResult(null);
        try {
            const res = await testLocalLlm({
                baseUrl: baseUrl.trim(),
                model: model.trim(),
                apiKey: apiKey.trim() || undefined,
                prompt: prompt.trim() || undefined,
            });
            setResult(res);
            if (res.ok) {
                toast.success(`연결 성공 (${res.latencyMs}ms)`);
            } else {
                toast.error('연결 실패');
            }
        } catch (error) {
            console.error('Local LLM test failed:', error);
            toast.error('테스트 중 오류가 발생했습니다');
        } finally {
            setTesting(false);
        }
    };

    const inputClass =
        'w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background font-mono';

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <div className="bg-gradient-to-r from-chart-2 to-primary p-2 rounded-lg">
                        <FlaskConical className="w-4 h-4 text-primary-foreground" />
                    </div>
                    로컬 LLM 연결 테스트
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                    사내/폐쇄망 vLLM 또는 로컬 LLM(Ollama·LM Studio 등) OpenAI 호환 엔드포인트를 검증합니다.
                    엔드포인트 도달성·추론·JSON 모드(추출 필수)를 한 번에 확인합니다.
                </p>

                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Base URL</label>
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="http://localhost:8000/v1"
                        className={inputClass}
                    />
                </div>

                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">모델명 (HF repo id 등)</label>
                    <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="upstage/SOLAR-10.7B-Instruct-v1.0"
                        className={inputClass}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">API Key (선택)</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="폐쇄망은 보통 불필요"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">테스트 프롬프트 (선택)</label>
                        <input
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="기본: 한국어 연결 테스트"
                            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                        />
                    </div>
                </div>

                <Button onClick={handleTest} disabled={testing} className="w-full">
                    {testing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Server className="w-4 h-4 mr-2" />}
                    {testing ? '테스트 중...' : '연결 테스트'}
                </Button>

                {result && (
                    <div
                        className={`rounded-lg border p-4 text-sm space-y-2 ${
                            result.ok
                                ? 'bg-chart-2/10 border-chart-2/30'
                                : 'bg-destructive/10 border-destructive/30'
                        }`}
                    >
                        <div className="flex items-center gap-2 font-medium">
                            {result.ok ? (
                                <CheckCircle2 className="w-4 h-4 text-chart-2" />
                            ) : (
                                <XCircle className="w-4 h-4 text-destructive" />
                            )}
                            {result.ok ? '연결 성공' : '연결 실패'}
                            <span className="ml-auto font-mono text-xs text-muted-foreground">
                                {result.endpoint} · {result.latencyMs}ms
                            </span>
                        </div>

                        {result.ok && (
                            <div className="text-xs text-muted-foreground">
                                JSON 모드:{' '}
                                <span className={result.jsonMode ? 'text-chart-2' : 'text-destructive'}>
                                    {result.jsonMode ? '지원 ✓' : '미지원 ✗ (추출 정확도 저하 가능)'}
                                </span>
                            </div>
                        )}

                        {result.modelsAvailable && result.modelsAvailable.length > 0 && (
                            <div className="text-xs">
                                <span className="text-muted-foreground">로드된 모델: </span>
                                <span className="font-mono">{result.modelsAvailable.join(', ')}</span>
                            </div>
                        )}

                        {result.sampleOutput && (
                            <pre className="whitespace-pre-wrap break-all bg-muted rounded p-2 text-xs font-mono max-h-40 overflow-auto">
                                {result.sampleOutput}
                            </pre>
                        )}

                        {result.error && (
                            <pre className="whitespace-pre-wrap break-all text-destructive text-xs font-mono">
                                {result.error}
                            </pre>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
