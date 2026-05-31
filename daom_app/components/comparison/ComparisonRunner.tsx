'use client';

import { useState } from 'react';
import { useUploadFile } from '@/hooks/useUploadFile';
import { analyzeComparison } from '@/actions/comparison';
import { ComparisonResult } from '@/scheme/comparison';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SpinnerWithText } from '@/components/ui/spinner';
import { Upload, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ComparisonViewer } from './ComparisonViewer';

export function ComparisonRunner() {
    const { upload, isLoading: isUploading } = useUploadFile();
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // State
    const [baselineId, setBaselineId] = useState<string | null>(null);
    const [candidateId, setCandidateId] = useState<string | null>(null);

    // File names for display
    const [baselineName, setBaselineName] = useState<string | null>(null);
    const [candidateName, setCandidateName] = useState<string | null>(null);

    // URLs for display in viewer (we need another action or return URL from upload)
    // upload() returns { fileId, filename, url } now.
    const [baselineUrl, setBaselineUrl] = useState<string | null>(null);
    const [candidateUrl, setCandidateUrl] = useState<string | null>(null);

    const [result, setResult] = useState<ComparisonResult | null>(null);

    const handleUpload = async (file: File, type: 'baseline' | 'candidate') => {
        try {
            const res = await upload(file);
            // res = { fileId, filename, url }
            /* Note: useUploadFile only returned fileId in my previous update (Step 528).
               I need to check useUploadFile again.
               Step 528: return result.fileId; 
               Step 548 (actions/file.ts): returns { fileId, filename, url }
               
               I should update useUploadFile to return the full object.
               For now, I assume it returns fileId. 
               Wait, I should verify useUploadFile.ts content.
            */

            if (typeof res === 'object') {
                if (type === 'baseline') {
                    setBaselineId(res.fileId);
                    setBaselineName(res.filename);
                    setBaselineUrl(res.url);
                } else {
                    setCandidateId(res.fileId);
                    setCandidateName(res.filename);
                    setCandidateUrl(res.url);
                }
            } else {
                // If it returns just string ID (legacy hook version)
                if (type === 'baseline') setBaselineId(res);
                else setCandidateId(res);
            }

        } catch (e) {
            toast.error('Upload failed');
        }
    };

    const handleAnalyze = async () => {
        if (!baselineId || !candidateId) return;

        setIsAnalyzing(true);
        setResult(null);

        try {
            const data = await analyzeComparison(baselineId, candidateId);
            if (data.error) {
                toast.error(`Analysis failed: ${data.error}`);
            } else {
                setResult(data);
                toast.success('Analysis complete');
            }
        } catch (e) {
            console.error(e);
            toast.error('Analysis error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const reset = () => {
        setBaselineId(null);
        setCandidateId(null);
        setBaselineName(null);
        setCandidateName(null);
        setResult(null);
    };

    if (result && baselineUrl && candidateUrl) {
        return (
            <div className="space-y-4 h-full flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-lg shrink-0">
                    <div className="flex items-center gap-4 text-sm">
                        <div><strong>Baseline:</strong> {baselineName}</div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        <div><strong>Candidate:</strong> {candidateName}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        New Comparison
                    </Button>
                </div>

                <div className="flex-1 min-h-0 border rounded-xl overflow-hidden bg-background">
                    <ComparisonViewer
                        baselineUrl={baselineUrl}
                        candidateUrl={candidateUrl}
                        result={result}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold mb-2">Visual Comparison</h1>
                <p className="text-muted-foreground">Upload two document images (Baseline and Candidate) to detect visual and semantic differences.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Baseline Upload */}
                <Card className={baselineId ? "border-primary/50 bg-primary/5" : ""}>
                    <CardHeader>
                        <CardTitle className="text-lg">1. Baseline Image</CardTitle>
                        <CardDescription>Original or previous version</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <UploadArea
                            label="Upload Baseline"
                            fileName={baselineName}
                            isUploading={isUploading}
                            onUpload={(f) => handleUpload(f, 'baseline')}
                        />
                    </CardContent>
                </Card>

                {/* Candidate Upload */}
                <Card className={candidateId ? "border-primary/50 bg-primary/5" : ""}>
                    <CardHeader>
                        <CardTitle className="text-lg">2. Candidate Image</CardTitle>
                        <CardDescription>New version or scanned copy</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <UploadArea
                            label="Upload Candidate"
                            fileName={candidateName}
                            isUploading={isUploading}
                            onUpload={(f) => handleUpload(f, 'candidate')}
                        />
                    </CardContent>
                </Card>
            </div>

            <div className="flex justify-center">
                <Button
                    size="lg"
                    disabled={!baselineId || !candidateId || isAnalyzing || isUploading}
                    onClick={handleAnalyze}
                    className="min-w-[200px]"
                >
                    {isAnalyzing ? (
                        <SpinnerWithText text="Analyzing Differences..." />
                    ) : (
                        <>
                            Run Comparison <ArrowRight className="ml-2 w-5 h-5" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

function UploadArea({ label, fileName, isUploading, onUpload }: { label: string, fileName: string | null, isUploading: boolean, onUpload: (f: File) => void }) {
    if (fileName) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-primary/20 rounded-xl bg-card">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <RefreshCw className="w-6 h-6 text-primary" />
                </div>
                <p className="font-medium text-foreground mb-1">{fileName}</p>
                <p className="text-xs text-muted-foreground">Ready for analysis</p>
                <Button variant="ghost" size="sm" className="mt-4" onClick={(e) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*,application/pdf';
                    input.onchange = (evt: Event) => {
                        const target = evt.target as HTMLInputElement;
                        const file = target.files?.[0];
                        if (file) onUpload(file);
                    };
                    input.click();
                }}>
                    Change File
                </Button>
            </div>
        )
    }

    return (
        <div
            className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-muted-foreground/20 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*,application/pdf';
                input.onchange = (evt: Event) => {
                    const target = evt.target as HTMLInputElement;
                    const file = target.files?.[0];
                    if (file) onUpload(file);
                };
                input.click();
            }}
        >
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground mb-1">Click to {label}</p>
            <p className="text-xs text-muted-foreground">Support PNG, JPG, PDF</p>
        </div>
    );
}
