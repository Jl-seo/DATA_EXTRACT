import { useState, useEffect } from 'react';
import { Building2, Image as ImageIcon, Type, Globe, Languages, Save, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import useSettings from '@/hooks/useSettings';

export function BrandingTab() {
    const {
        appName,
        faviconUrl,
        appDescription,
        isSaving,
        faviconObjectUrlRef,
        setPendingFaviconFile,
        setFaviconUrl,
        setAppName,
        setAppDescription,
        handleDefaultSettingsSave,
        appDescriptionRef,
    } = useSettings();

    const handleFilePick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const previewUrl = URL.createObjectURL(file);

            if (faviconObjectUrlRef.current) URL.revokeObjectURL(faviconObjectUrlRef.current);
            faviconObjectUrlRef.current = previewUrl;
            setPendingFaviconFile(file);
            setFaviconUrl(previewUrl);

            toast.success('미리보기로 적용되었습니다. 저장을 눌러 반영하세요.');
        };
        input.click();
    };

    return (
        <div className="space-y-6">
            {/* Service Identity */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Type className="w-4 h-4" />
                        서비스 이름
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="app-name" className="text-sm font-medium text-muted-foreground">
                                서비스 이름
                            </Label>
                            <Input
                                id="app-name"
                                value={appName ?? ''}
                                onChange={(e) => setAppName(e.target.value)}
                                placeholder="예: DAOM"
                                className="h-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="app-description" className="text-sm font-medium text-muted-foreground">
                                서비스 설명
                            </Label>
                            <Textarea
                                ref={appDescriptionRef}
                                id="app-description"
                                value={appDescription}
                                onChange={(e) => {
                                    setAppDescription(e.target.value);
                                    if (appDescriptionRef.current) {
                                        appDescriptionRef.current.value = e.target.value;
                                    }
                                }}
                                placeholder="예: AI 문서 자동화 솔루션"
                                className="min-h-[40px] h-10 py-2 resize-none"
                            />
                        </div>
                    </div>

                    <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3">미리보기</p>
                        <div className="flex items-center gap-3">
                            <IdentityPreviewImage url={faviconUrl} />
                            <div>
                                <div className="font-bold text-foreground text-base leading-none mb-1">{appName || 'DAOM'}</div>
                                <div className="text-xs text-muted-foreground line-clamp-1">{appDescription || '문서 자동화 서비스'}</div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Asset Management */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <ImageIcon className="w-4 h-4" />
                        로고
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="max-w-2xl">
                        <LogoUploadSection
                            label="로고 업로드(또는 URL 입력)"
                            url={faviconUrl}
                            onPick={handleFilePick}
                            onReset={() => { setFaviconUrl('/icon.png'); setPendingFaviconFile(null); }}
                            onUrlChange={(val) => { setFaviconUrl(val); setPendingFaviconFile(null); }}
                            icon={<ImageIcon className="w-8 h-8 text-muted-foreground" />}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Global Actions */}
            <div className="flex items-center justify-end pt-2">
                <Button
                    onClick={handleDefaultSettingsSave}
                    disabled={isSaving}
                    className="px-8 shadow-lg shadow-primary/20"
                >
                    {isSaving ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4 mr-2" />
                    )}
                    {isSaving ? '저장 중...' : '브랜딩 설정 저장'}
                </Button>
            </div>
        </div>
    );
}

function IdentityPreviewImage({ url }: { url?: string }) {
    const [error, setError] = useState(false);

    useEffect(() => {
        setError(false);
    }, [url]);

    if (url && !error) {
        return (
            <img
                src={url}
                alt="App icon preview"
                className="w-11 h-11 rounded-xl object-contain bg-background border border-border/50 shadow-sm"
                onError={() => setError(true)}
            />
        );
    }

    return (
        <div className="w-11 h-11 rounded-xl bg-linear-to-br from-primary to-chart-5 flex items-center justify-center shadow-sm">
            <Building2 className="w-5 h-5 text-primary-foreground" />
        </div>
    );
}

interface LogoUploadSectionProps {
    label: string;
    url?: string;
    onPick: () => void;
    onReset: () => void;
    onUrlChange: (url: string) => void;
    icon: React.ReactNode;
}

function LogoUploadSection({ label, url, onPick, onReset, onUrlChange, icon }: LogoUploadSectionProps) {
    const [error, setError] = useState(false);

    useEffect(() => {
        setError(false);
    }, [url]);

    return (
        <div className="space-y-4 p-5 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/30 transition-all duration-200">
            <div className="flex flex-col sm:flex-row gap-6">
                {/* Preview side */}
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">미리보기</Label>
                    <div className="w-24 h-24 rounded-2xl bg-background border border-border/80 flex items-center justify-center overflow-hidden shadow-xs ring-4 ring-muted/10 group-hover:ring-muted/20 transition-all">
                        {url && !error ? (
                            <img
                                src={url}
                                alt={label}
                                className="w-full h-full object-contain p-2"
                                onError={() => setError(true)}
                            />
                        ) : (
                            icon
                        )}
                    </div>
                </div>

                {/* Controls side */}
                <div className="flex-1 flex flex-col justify-between py-1 gap-4">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground/90">{label}</Label>
                        <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={onPick} className="flex-1 text-xs font-bold h-9">
                                <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
                                파일 업로드
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="px-3 text-destructive hover:text-destructive hover:bg-destructive/5 h-9 border-border/50"
                                onClick={onReset}
                                title="기본값 복원"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider ml-0.5">URL 직접 입력</Label>
                        <Input
                            value={url ?? ''}
                            onChange={(e) => onUrlChange(e.target.value)}
                            placeholder="https://..."
                            className="h-9 text-xs bg-background/50 border-border/50"
                        />
                        {error && url && (
                            <p className="text-[10px] text-destructive font-medium ml-0.5">이미지를 불러올 수 없습니다. URL을 확인해 주세요.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
