"use client";

import { useState } from 'react';
import { Palette, RotateCcw, Sun, Moon, Check, Save, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { themePresets } from '@/scheme/themeConfig';
import useSettings from '@/hooks/useSettings';
import { useTheme } from 'next-themes';

export function ThemeTab() {
    const {
        theme,
        // setTheme,
        updateTheme,
        radius,
        // setRadius,
        updateRadius,
        density,
        // setDensity,
        updateDensity,
        primaryColor,
        // setPrimaryColor,
        updatePrimaryColor,
        isSaving,
    } = useSettings();

    const { setTheme: setNextTheme } = useTheme();

    const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
        updateTheme(newTheme);
        setNextTheme(newTheme);
        // toast.success(`테마가 ${newTheme === 'light' ? '라이트' : newTheme === 'dark' ? '다크' : '시스템'} 모드로 반영되었습니다`);
    };

    const handleDensityChange = (newDensity: 'compact' | 'normal' | 'comfortable') => {
        updateDensity(newDensity);
        // toast.success('UI 밀도가 변경되었습니다(저장 후 반영)');
    };

    const handleRadiusChange = (newRadius: number) => {
        updateRadius(newRadius);
        // toast.success('모서리 둥글기가 변경되었습니다(저장 후 반영)');
    };

    const applyPreset = (presetKey: string) => {
        const _presetKey = presetKey as keyof typeof themePresets;
        const preset = themePresets[_presetKey];
        updatePrimaryColor(preset.primary);
        toast.success(`${preset.name} 컬러 프리셋이 선택되었습니다`);
    };

    const resetToDefaults = () => {
        handleThemeChange('system');
        updateDensity('normal');
        updateRadius(0.5);
        updatePrimaryColor('oklch(0.6723 0.1606 244.9955)'); // Default Blue
    };

    return (
        <div className="space-y-6">
            {/* Theme Mode */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Sun className="w-4 h-4" />
                        테마 모드
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        <Button
                            variant={theme === 'light' ? 'default' : 'outline'}
                            onClick={() => handleThemeChange('light')}
                            className="flex-1"
                        >
                            <Sun className="w-4 h-4 mr-2" />
                            라이트
                        </Button>
                        <Button
                            variant={theme === 'dark' ? 'default' : 'outline'}
                            onClick={() => handleThemeChange('dark')}
                            className="flex-1"
                        >
                            <Moon className="w-4 h-4 mr-2" />
                            다크
                        </Button>
                        <Button
                            variant={theme === 'system' ? 'default' : 'outline'}
                            onClick={() => handleThemeChange('system')}
                            className="flex-1"
                        >
                            시스템
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Color Presets */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Palette className="w-4 h-4" />
                        컬러 프리셋
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                        {Object.entries(themePresets).map(([key, preset]) => {
                            const isActive = primaryColor === preset.primary;
                            return (
                                <button
                                    key={key}
                                    onClick={() => applyPreset(key)}
                                    className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left relative ${isActive
                                        ? 'border-primary bg-primary/10 shadow-sm'
                                        : 'border-border hover:bg-accent hover:border-primary/50'
                                        }`}
                                >
                                    <div
                                        className="w-8 h-8 rounded-full shadow-inner flex items-center justify-center"
                                        style={{ background: preset.primary }}
                                    >
                                        {isActive && <Check className="w-4 h-4 text-white" />}
                                    </div>
                                    <span className="text-sm font-medium flex-1">{preset.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Custom Primary Color */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">커스텀 Primary 색상</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 flex-1">
                            <input
                                type="color"
                                className="w-12 h-12 rounded-lg border-2 border-border cursor-pointer p-1 bg-background"
                                onChange={(e) => updatePrimaryColor(e.target.value)}
                                // Note: input type=color only supports hex. Dynamic conversion might be needed if we want full oklch support here, 
                                // but setting hex to primaryColor works with our css variable logic.
                                value={primaryColor?.startsWith('#') ? primaryColor : '#000000'}
                            />
                            <div className="flex-1">
                                <p className="text-sm font-medium">직접 선택</p>
                                <p className="text-xs text-muted-foreground">
                                    원하는 색상을 선택하세요 (Hex)
                                </p>
                            </div>
                        </div>
                        <Input
                            className="w-32 font-mono text-xs"
                            value={primaryColor}
                            onChange={(e) => updatePrimaryColor(e.target.value)}
                            placeholder="Color value..."
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Style & Size */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Palette className="w-4 h-4" />
                        스타일 & 크기
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Density */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-muted-foreground block">
                            UI 밀도 (텍스트 & 여백)
                        </label>
                        <div className="flex gap-2">
                            <Button
                                variant={density === 'compact' ? 'default' : 'outline'}
                                onClick={() => handleDensityChange('compact')}
                                className="flex-1"
                            >
                                좁게
                            </Button>
                            <Button
                                variant={density === 'normal' ? 'default' : 'outline'}
                                onClick={() => handleDensityChange('normal')}
                                className="flex-1"
                            >
                                보통
                            </Button>
                            <Button
                                variant={density === 'comfortable' ? 'default' : 'outline'}
                                onClick={() => handleDensityChange('comfortable')}
                                className="flex-1"
                            >
                                넓게
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            전체적인 텍스트 크기와 여백을 조절합니다.
                        </p>
                    </div>

                    {/* Radius */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-muted-foreground block">
                            모서리 둥글기
                        </label>
                        <div className="grid grid-cols-5 gap-2">
                            {[0, 0.3, 0.5, 0.75, 1.0].map((r) => (
                                <Button
                                    key={r}
                                    variant={radius === r ? 'default' : 'outline'}
                                    onClick={() => handleRadiusChange(r)}
                                    className="px-2"
                                    title={`${r}rem`}
                                >
                                    <div
                                        className="w-4 h-4 border-2 border-current"
                                        style={{ borderRadius: `${r}rem` }}
                                    />
                                </Button>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Global Actions */}
            <div className="flex flex-col gap-3 pt-2">
                {/* Save button removed for real-time updates */}
                {/* <Button
                    onClick={handleDefaultSettingsSave}
                    disabled={isSaving}
                    className="w-full h-11 shadow-lg shadow-primary/20"
                >
                    {isSaving ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4 mr-2" />
                    )}
                    {isSaving ? '저장 중...' : '테마 설정 저장'}
                </Button> */}

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetToDefaults}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    기본값으로 초기화
                </Button>
            </div>
        </div>
    );
}
