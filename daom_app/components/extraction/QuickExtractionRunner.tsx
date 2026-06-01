'use client';

import { useState } from 'react';
import { Upload, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function QuickExtractionRunner() {
    const [uploading, setUploading] = useState(false);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setUploading(true);
        // Simulation
        setTimeout(() => {
            toast.error("빠른 추출 기능은 아직 서버에 연결되지 않았습니다.");
            setUploading(false);
        }, 1000);
    };

    return (
        <div className="w-full h-[1000px] border-2 border-dashed border-sky-100 rounded-xl bg-slate-50/50 flex flex-col items-center justify-center p-12 transition-colors hover:bg-sky-50/30 hover:border-sky-200">
            <div className="p-4 bg-white rounded-full shadow-sm mb-6">
                <Upload className="w-8 h-8 text-sky-500" />
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-2">
                파일을 여기에 놓거나 클릭하세요
            </h3>

            <p className="text-slate-500 mb-8 text-center max-w-md">
                JPG, PNG, PDF 지원.<br />
                카메라 촬영 사진도 가능합니다.
            </p>

            <input
                type="file"
                id="quick-upload"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
                accept=".jpg,.jpeg,.png,.pdf"
            />

            {/* Hidden Input Trigger via Label or container click if implemented properly. 
                For now, creating a clickable label area overlay or just a button. 
                Screenshot behaves like a dropzone. */}

            <Button asChild size="lg" className="px-8 font-semibold" disabled={uploading}>
                <label htmlFor="quick-upload" className="cursor-pointer">
                    {uploading ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            업로드 중...
                        </>
                    ) : (
                        '문서 선택하기'
                    )}
                </label>
            </Button>
        </div>
    );
}
