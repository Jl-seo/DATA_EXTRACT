"use client";

import { useState, useEffect } from 'react';
import { Terminal, RefreshCw, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getLLMSettings, updateLLMSettings } from '@/actions/llmSettings';
import { LLMSettings, DEFAULT_PROMPTS } from '@/scheme/llmSettings';

export function PromptTab() {
    const [settings, setSettings] = useState<LLMSettings | null>(null);
    const [prompts, setPrompts] = useState({
        extraction_system: '',
        extraction_system_role: '',
        template_chat: '',
        comparison_system: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const data = await getLLMSettings();
            setSettings(data);
            setPrompts({
                extraction_system: data.extraction_system || DEFAULT_PROMPTS.extraction_system,
                extraction_system_role: data.extraction_system_role || DEFAULT_PROMPTS.extraction_system_role,
                template_chat: data.template_chat || DEFAULT_PROMPTS.template_chat,
                comparison_system: data.comparison_system || DEFAULT_PROMPTS.comparison_system,
            });
        } catch (error) {
            console.error('Failed to load settings:', error);
            toast.error('프롬프트 설정을 불러올 수 없습니다');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = (key: keyof typeof DEFAULT_PROMPTS) => {
        setPrompts((prev) => ({
            ...prev,
            [key]: DEFAULT_PROMPTS[key],
        }));
        toast.info('기본값으로 복원되었습니다. 저장 버튼을 눌러야 반영됩니다.');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const updated = await updateLLMSettings(prompts);
            setSettings(updated);
            toast.success('프롬프트 설정이 저장되었습니다.');
        } catch (error) {
            console.error('Failed to save prompts:', error);
            toast.error('프롬프트 저장 실패');
        } finally {
            setSaving(false);
        }
    };

    const hasChanges = settings && (
        prompts.extraction_system !== settings.extraction_system ||
        prompts.extraction_system_role !== settings.extraction_system_role ||
        prompts.template_chat !== settings.template_chat ||
        prompts.comparison_system !== settings.comparison_system
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
                <CardTitle className="flex items-center gap-2 text-base">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-2 rounded-lg">
                        <Terminal className="w-4 h-4 text-white" />
                    </div>
                    시스템 프롬프트 설정
                </CardTitle>
                <Button
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    size="sm"
                    className="h-9"
                >
                    {saving ? (
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                        <Save className="w-4 h-4 mr-2" />
                    )}
                    저장
                </Button>
            </CardHeader>
            <CardContent className="space-y-8">
                {/* Extraction Main Prompt */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                데이터 추출 메인 프롬프트
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">extraction_system</span>
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1">LLM에게 보내는 데이터 추출 및 구조화 지침입니다.</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleReset('extraction_system')} className="h-7 text-xs gap-1">
                            <RotateCcw className="w-3 h-3" />
                            복원
                        </Button>
                    </div>
                    <textarea
                        value={prompts.extraction_system}
                        onChange={(e) => setPrompts({ ...prompts, extraction_system: e.target.value })}
                        className="w-full h-48 px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-muted/30"
                    />
                </div>

                {/* Extraction Role Prompt */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                추출 시스템 역할 (Role)
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">extraction_system_role</span>
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1">추출 시 LLM의 시스템 페르소나를 정의합니다.</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleReset('extraction_system_role')} className="h-7 text-xs gap-1">
                            <RotateCcw className="w-3 h-3" />
                            복원
                        </Button>
                    </div>
                    <textarea
                        value={prompts.extraction_system_role}
                        onChange={(e) => setPrompts({ ...prompts, extraction_system_role: e.target.value })}
                        className="w-full h-20 px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-muted/30"
                    />
                </div>

                {/* Template Chat Prompt */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                템플릿 챗 AI 프롬프트
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">template_chat</span>
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1">템플릿 커스터마이징 챗봇의 지침입니다.</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleReset('template_chat')} className="h-7 text-xs gap-1">
                            <RotateCcw className="w-3 h-3" />
                            복원
                        </Button>
                    </div>
                    <textarea
                        value={prompts.template_chat}
                        onChange={(e) => setPrompts({ ...prompts, template_chat: e.target.value })}
                        className="w-full h-48 px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-muted/30"
                    />
                </div>

                {/* Image Comparison Prompt */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                이미지 비교 시스템 프롬프트
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">comparison_system</span>
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1">두 리포트 이미지 비교 시 LLM에 전달되는 지침입니다.</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleReset('comparison_system')} className="h-7 text-xs gap-1">
                            <RotateCcw className="w-3 h-3" />
                            복원
                        </Button>
                    </div>
                    <textarea
                        value={prompts.comparison_system}
                        onChange={(e) => setPrompts({ ...prompts, comparison_system: e.target.value })}
                        className="w-full h-48 px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-muted/30"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
