'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Globe, Image as ImageIcon, Languages, Save } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface BasicInfoCardProps {
  appName: string;
  faviconUrl: string;
  appIconUrl: string;
  loginIconUrl: string;
  characterIconUrl: string;
  appDescription: string;
  isSaving: boolean;
  className?: string;
  onPickFaviconFile: (file: File | null, previewUrl: string) => void;
  onPickAppIconFile: (file: File | null, previewUrl: string) => void;
  onPickLoginIconFile: (file: File | null, previewUrl: string) => void;
  onPickCharacterIconFile: (file: File | null, previewUrl: string) => void;
  onAppNameChange: (value: string) => void;
  onSave: () => void;
  appDescriptionRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function BasicInfoCard({
  appName,
  faviconUrl,
  appIconUrl,
  loginIconUrl,
  characterIconUrl,
  appDescription,
  isSaving,
  className,
  onPickFaviconFile,
  onPickAppIconFile,
  onPickLoginIconFile,
  onPickCharacterIconFile,
  onAppNameChange,
  onSave,
  appDescriptionRef,
}: BasicInfoCardProps) {
  const handleFilePick = (
    type: 'favicon' | 'appIcon' | 'loginIcon' | 'characterIcon',
  ) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const previewUrl = URL.createObjectURL(file);

      if (type === 'favicon') {
        onPickFaviconFile(file, previewUrl);
      } else if (type === 'appIcon') {
        onPickAppIconFile(file, previewUrl);
      } else if (type === 'loginIcon') {
        onPickLoginIconFile(file, previewUrl);
      } else {
        onPickCharacterIconFile(file, previewUrl);
      }

      toast.success('미리보기로 적용되었습니다. 저장을 눌러 반영하세요.');
    };
    input.click();
  };

  useEffect(() => {
    if (appDescriptionRef.current) {
      appDescriptionRef.current.value = appDescription;
    }
  }, [appDescription]);

  return (
    <Card
      className={cn(
        'border-border shadow-sm rounded-xl overflow-hidden bg-card',
        className,
      )}
    >
      <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-sky-100 rounded-lg">
            <Globe className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">기본 정보</h3>
          </div>
        </div>

        <Button
          onClick={onSave}
          disabled={isSaving}
          className="bg-sky-600 hover:bg-sky-700 text-white gap-2 h-8 rounded-lg shadow-sm px-4"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="font-bold text-sm">저장</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2 p-4 lg:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
          <Label
            htmlFor="app-name"
            className="text-sm font-bold text-muted-foreground"
          >
            앱 이름
          </Label>
          <div className="md:col-span-3">
            <Input
              id="app-name"
              value={appName}
              onChange={(e) => onAppNameChange(e.target.value)}
              placeholder="앱 이름을 입력하세요"
              className="max-w-md h-9 border-input focus:ring-ring rounded-lg text-sm"
            />
          </div>
        </div>

        {/* favicon */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start border-t border-border pt-2">
          <Label className="text-sm font-bold text-muted-foreground mt-2">
            앱 헤더 로고
          </Label>
          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md bg-card border border-border flex items-center justify-center overflow-hidden shrink-0 group transition-colors">
                {faviconUrl ? (
                  <img
                    src={faviconUrl}
                    alt="Favicon Preview"
                    className="w-5 h-5 object-contain"
                  />
                ) : (
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold border-border px-2.5"
                    onClick={() => handleFilePick('favicon')}
                  >
                    파일 선택
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold text-rose-500 hover:bg-rose-50 px-2.5"
                    onClick={() => onPickFaviconFile(null, '/favicon.ico')}
                  >
                    초기화
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 앱 로고 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start border-t border-border pt-2">
          <Label className="text-sm font-bold text-muted-foreground mt-2">
            앱 로고
          </Label>
          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md bg-card border border-border flex items-center justify-center overflow-hidden shrink-0 group transition-colors">
                {appIconUrl ? (
                  <img
                    src={appIconUrl}
                    alt="App Icon Preview"
                    className="w-7.5 h-7.5 object-contain border border-border"
                  />
                ) : (
                  <div className="p-1.5 bg-muted rounded-lg border border-border">
                    <Languages className="w-6 h-6 text-primary" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold border-border px-2.5"
                    onClick={() => handleFilePick('appIcon')}
                  >
                    파일 선택
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold text-rose-500 hover:bg-rose-50 px-2.5"
                    onClick={() => onPickAppIconFile(null, '')}
                  >
                    초기화
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 로그인 로고 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start border-t border-border pt-2">
          <Label className="text-sm font-bold text-muted-foreground mt-2">
            로그인 로고
          </Label>
          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md bg-card border border-border flex items-center justify-center overflow-hidden shrink-0 group transition-colors">
                {loginIconUrl ? (
                  <img
                    src={loginIconUrl}
                    alt="Login Icon Preview"
                    className="w-20 h-20 object-contain"
                  />
                ) : (
                  <Languages className="w-20 h-20 text-primary shrink-" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold border-border px-2.5"
                    onClick={() => handleFilePick('loginIcon')}
                  >
                    파일 선택
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold text-rose-500 hover:bg-rose-50 px-2.5"
                    onClick={() => onPickLoginIconFile(null, '')}
                  >
                    초기화
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4 lg:p-6 space-y-4 pt-0">
        {/* 캐릭터 로고 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start border-t border-border pt-2">
          <Label className="text-sm font-bold text-muted-foreground mt-2">
            캐릭터 로고
          </Label>
          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md bg-card border border-border flex items-center justify-center overflow-hidden shrink-0 group transition-colors">
                {characterIconUrl ? (
                  <img
                    src={characterIconUrl}
                    alt="Character Icon Preview"
                    className="w-20 h-20 object-contain"
                  />
                ) : (
                  <img
                    src="/raccoon.png"
                    alt="Character Default"
                    className="w-20 h-20 object-contain"
                  />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold border-border px-2.5"
                    onClick={() => handleFilePick('characterIcon')}
                  >
                    파일 선택
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md text-xs font-bold text-rose-500 hover:bg-rose-50 px-2.5"
                    onClick={() => onPickCharacterIconFile(null, '')}
                  >
                    초기화
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 앱 설명 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center border-t border-border pt-2">
          <Label
            htmlFor="character-description"
            className="text-sm font-bold text-muted-foreground"
          >
            앱 설명
          </Label>
          <div className="md:col-span-3">
            <Textarea
              ref={appDescriptionRef}
              id="character-description"
              // onChange={(e) => onAppDescriptionChange(e.target.value)}
              onChange={(e) => {
                if (appDescriptionRef.current) {
                  appDescriptionRef.current.value = e.target.value;
                }
              }}
              placeholder="캐릭터 설명을 입력하세요 (예: AI랑 124개 언어로 후다닥 번역! 📝)"
              className="max-w-md h-9 border-input focus:ring-ring rounded-lg text-sm"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
