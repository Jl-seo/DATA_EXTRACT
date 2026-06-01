"use client";

import { useState } from 'react';
import { Settings, Cpu, Terminal, Building2, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LLMTab } from './tabs/LLMTab';
import { PromptTab } from './tabs/PromptTab';
import { BrandingTab } from './tabs/BrandingTab';
import { ThemeTab } from './tabs/ThemeTab';

type SettingsTab = 'llm' | 'prompt' | 'branding' | 'theme';

const tabs = [
    { id: 'llm' as const, label: 'LLM 모델', icon: Cpu },
    { id: 'prompt' as const, label: '프롬프트', icon: Terminal },
    { id: 'branding' as const, label: '사이트 설정', icon: Building2 },
    { id: 'theme' as const, label: '테마', icon: Palette },
];

export function GeneralSettingsTabs() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('llm');

    return (
        <div className="max-w-3xl mx-auto p-6 font-sans">
            {/* Header */}
            <div className="mb-6">
                <h2 className="text-2xl font-black text-foreground mb-1 flex items-center gap-2">
                    <Settings className="w-6 h-6" />
                    관리자 설정
                </h2>
                <p className="text-sm text-muted-foreground">AI 모델, 브랜딩, 테마 설정</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 bg-muted p-1 rounded-lg">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all",
                            activeTab === tab.id
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'llm' && <LLMTab />}
            {activeTab === 'prompt' && <PromptTab />}
            {activeTab === 'branding' && <BrandingTab />}
            {activeTab === 'theme' && <ThemeTab />}
        </div>
    );
}
