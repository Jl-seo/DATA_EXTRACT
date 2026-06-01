'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import {
  BookOpen,
  FileText,
  Loader2,
  MousePointerClick,
  Save,
  Upload,
} from 'lucide-react';

import { confirmFileUpload, generateUploadSasUrl } from '@/actions/file';
import { useExtractionModels } from '@/queries/extraction';
import {
  useConfirmMetaPromptDraft,
  useGenerateMetaPromptDraft,
  usePromptProfile,
  useUpdateMetaPromptDraft,
} from '@/queries/promptProfile';
import type { PromptSelection } from '@/scheme/promptProfile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PromptDocumentSelectionViewer = dynamic(
  () =>
    import('./PromptDocumentSelectionViewer').then(
      (mod) => mod.PromptDocumentSelectionViewer
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[460px] items-center justify-center rounded-lg border bg-muted/10 text-sm text-muted-foreground">
        문서 뷰어 로딩 중...
      </div>
    ),
  }
);

type UploadedDoc = {
  fileId: string;
  filename: string;
  url: string;
};

type SelectionFieldOption = {
  key: string;
};

export function PromptWorkbenchView() {
  const searchParams = useSearchParams();
  const modelIdFromQuery = searchParams.get('modelId') || '';
  const { data: models = [] } = useExtractionModels({ offset: 0, pageSize: 200 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDoc | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [selections, setSelections] = useState<PromptSelection[]>([]);
  const [generationNote, setGenerationNote] = useState<string>('');
  const [draftPrompt, setDraftPrompt] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const effectiveModelId = selectedModelId || modelIdFromQuery;
  const { data: profile } = usePromptProfile(effectiveModelId);
  const generateDraftMutation = useGenerateMetaPromptDraft();
  const confirmDraftMutation = useConfirmMetaPromptDraft();
  const updateDraftMutation = useUpdateMetaPromptDraft();

  const selectableModels = useMemo(
    () => models.filter((model) => model.model_type !== 'comparison' && !model.is_super_model),
    [models]
  );

  const selectedModel = selectableModels.find((model) => model.id === effectiveModelId);
  const selectionFieldOptions = useMemo<SelectionFieldOption[]>(() => {
    if (!selectedModel?.fields || selectedModel.fields.length === 0) return [];

    return selectedModel.fields.map((field) => ({ key: field.key }));
  }, [selectedModel]);
  const versions = useMemo(() => {
    const items = profile?.versions || [];
    return [...items].sort((a, b) => b.version - a.version);
  }, [profile]);
  const selectedVersion = versions.find((version) => version.id === selectedVersionId);

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      const draft = versions.find((version) => version.status === 'draft');
      const target = draft || versions[0];
      setSelectedVersionId(target.id);
      setDraftPrompt(target.prompt_text);
      return;
    }

    if (!selectedVersionId) return;
    const current = versions.find((version) => version.id === selectedVersionId);
    if (!current) {
      setSelectedVersionId('');
      setDraftPrompt('');
    }
  }, [selectedVersionId, versions]);

  const handlePickFile = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const { sasUrl, fileId } = await generateUploadSasUrl(file.name, 'documents');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasUrl, true);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          reject(new Error(`파일 업로드 실패 (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error('파일 업로드 중 네트워크 오류가 발생했습니다.'));
        xhr.send(file);
      });
      const confirmed = await confirmFileUpload(fileId);
      const removedBlankPages = Array.isArray((confirmed as { removed_blank_pages?: unknown }).removed_blank_pages)
        ? (confirmed as { removed_blank_pages: unknown[] }).removed_blank_pages.filter((page): page is number => typeof page === 'number')
        : [];
      setUploadedDoc({
        fileId: confirmed.fileId,
        filename: confirmed.filename,
        url: confirmed.url,
      });
      setSelections([]);
      setGenerationNote('');
      setDraftPrompt('');
      setSelectedVersionId('');
      if (removedBlankPages.length > 0) {
        toast.info(`빈 페이지 ${removedBlankPages.length}개를 자동 제거했습니다. (${removedBlankPages.join(', ')})`);
      }
      toast.success('워크벤치 문서 업로드가 완료되었습니다.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : '문서 업로드 실패');
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!effectiveModelId) {
      toast.error('모델을 먼저 선택하세요.');
      return;
    }
    if (!uploadedDoc) {
      toast.error('문서를 먼저 업로드하세요.');
      return;
    }
    if (selections.length === 0) {
      toast.error('문서에서 선택 영역을 1개 이상 지정하세요.');
      return;
    }

    try {
      const result = await generateDraftMutation.mutateAsync({
        model_id: effectiveModelId,
        file_id: uploadedDoc.fileId,
        selections,
        generation_note: generationNote || undefined,
      });
      setDraftPrompt(result.draftVersion.prompt_text);
      setSelectedVersionId(result.draftVersion.id);
      toast.success(`Draft v${result.draftVersion.version} 생성 완료`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : '메타 프롬프트 생성 실패');
    }
  };

  const handleSaveDraftEdit = async () => {
    if (!effectiveModelId || !selectedVersionId) {
      toast.error('저장할 draft 버전을 선택하세요.');
      return;
    }
    if (!draftPrompt.trim()) {
      toast.error('프롬프트 내용을 입력하세요.');
      return;
    }
    try {
      await updateDraftMutation.mutateAsync({
        model_id: effectiveModelId,
        version_id: selectedVersionId,
        prompt_text: draftPrompt,
      });
      toast.success('Draft 프롬프트가 저장되었습니다.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Draft 저장 실패');
    }
  };

  const handleConfirmDraft = async () => {
    if (!effectiveModelId || !selectedVersionId) {
      toast.error('확정할 draft 버전을 선택하세요.');
      return;
    }
    try {
      await confirmDraftMutation.mutateAsync({
        model_id: effectiveModelId,
        version_id: selectedVersionId,
      });
      toast.success('프롬프트가 active 버전으로 확정되었습니다.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : '프롬프트 확정 실패');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">프롬프트 워크벤치</p>
            <p className="text-xs text-muted-foreground">
              이 기능은 문서의 핵심 영역을 기준으로 모델 추출 프롬프트를 생성 및 보완하고 버전 관리하는 워크벤치 입니다.<br/>
              문서 업로드 → 범위 선택 → Draft 생성 → 내용 수정 → 확정 저장(모델 반영) 순서로 사용하세요.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">워크벤치 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">대상 모델</Label>
              <Select value={effectiveModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger>
                  <SelectValue placeholder="모델을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {selectableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-semibold">현재 선택 모델</p>
              <p className="text-xs text-muted-foreground">{selectedModel?.name || '선택 안됨'}</p>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-semibold">워크벤치 문서</p>
              {uploadedDoc ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{uploadedDoc.filename}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <Upload className="h-4 w-4" />
                    문서 교체
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <FileText className="h-4 w-4" />
                  문서 업로드
                </Button>
              )}
              {isUploading && (
                <p className="text-xs text-muted-foreground">업로드 진행 중: {uploadProgress}%</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0];
                  if (nextFile) {
                    void handlePickFile(nextFile);
                  }
                  event.currentTarget.value = '';
                }}
              />
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-semibold">선택 영역 ({selections.length})</p>
              {selections.length === 0 && (
                <p className="text-xs text-muted-foreground">문서 미리보기에서 마우스로 여러 범위를 선택하세요.</p>
              )}
              <div className="max-h-44 space-y-2 overflow-auto pr-1">
                {selections.map((selection, index) => (
                  <div key={selection.id} className="rounded border bg-background p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold">P{selection.page_number} / #{index + 1}</span>
                      <button
                        type="button"
                        className="text-[10px] text-destructive"
                        onClick={() => setSelections((prev) => prev.filter((item) => item.id !== selection.id))}
                      >
                        삭제
                      </button>
                    </div>
                    <Select
                      value={selection.field_key || '__unset__'}
                      onValueChange={(value) => {
                        if (value === '__unset__') {
                          setSelections((prev) =>
                            prev.map((item) =>
                              item.id === selection.id
                                ? { ...item, field_key: undefined }
                                : item
                            )
                          );
                          return;
                        }

                        setSelections((prev) =>
                          prev.map((item) =>
                            item.id === selection.id
                              ? {
                                ...item,
                                field_key: value,
                                label: value,
                              }
                              : item
                          )
                        );
                      }}
                    >
                      <SelectTrigger className="mb-1 h-8 text-xs">
                        <SelectValue placeholder="모델 필드 키 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">선택 안함</SelectItem>
                        {selectionFieldOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={selection.note || ''}
                      onChange={(event) => {
                        const nextNote = event.target.value;
                        setSelections((prev) =>
                          prev.map((item) => (item.id === selection.id ? { ...item, note: nextNote } : item))
                        );
                      }}
                      className="h-8 text-xs"
                      placeholder="영역 설명(선택)"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">생성 추가 지시</Label>
              <Textarea
                value={generationNote}
                onChange={(event) => setGenerationNote(event.target.value)}
                className="min-h-[84px] text-xs"
                placeholder="예: 테이블 머리글/행 번호 규칙을 더 엄격히 반영"
              />
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                className="w-full justify-center gap-2"
                onClick={() => void handleGenerateDraft()}
                disabled={!effectiveModelId || !uploadedDoc || selections.length === 0 || generateDraftMutation.isPending}
              >
                {generateDraftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MousePointerClick className="h-4 w-4" />}
                선택 영역 기반 Draft 생성
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center"
                onClick={() => {
                  setSelections([]);
                  setGenerationNote('');
                }}
                disabled={selections.length === 0}
              >
                선택 영역 초기화
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">문서 범위 선택</CardTitle>
            </CardHeader>
            <CardContent>
              {uploadedDoc ? (
                <PromptDocumentSelectionViewer
                  fileUrl={uploadedDoc.url}
                  filename={uploadedDoc.filename}
                  selections={selections}
                  onChange={setSelections}
                />
              ) : (
                <div className="flex h-[460px] items-center justify-center rounded-lg border bg-muted/10 text-sm text-muted-foreground">
                  문서를 업로드하면 여기에서 다중 범위 선택을 시작할 수 있습니다.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">메타 프롬프트 Draft</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr]">
                <Select
                  value={selectedVersionId}
                  onValueChange={(versionId) => {
                    setSelectedVersionId(versionId);
                    const target = versions.find((version) => version.id === versionId);
                    if (target) setDraftPrompt(target.prompt_text);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Draft/버전 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        v{version.version} · {version.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center text-xs text-muted-foreground">
                  active: {profile?.active_version_id ? `설정됨 (${profile.active_version_id.slice(0, 8)}...)` : '없음'}
                </div>
              </div>

              <Textarea
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder="선택 영역을 기반으로 생성된 메타 프롬프트가 여기에 표시됩니다."
                className="min-h-[320px]"
              />

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDraftPrompt('')}
                  disabled={!draftPrompt}
                >
                  초기화
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleSaveDraftEdit()}
                  disabled={!selectedVersion || selectedVersion.status !== 'draft' || updateDraftMutation.isPending}
                >
                  {updateDraftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Draft 저장
                </Button>
                <Button
                  type="button"
                  className="gap-2"
                  onClick={() => void handleConfirmDraft()}
                  disabled={!selectedVersion || selectedVersion.status !== 'draft' || confirmDraftMutation.isPending}
                >
                  {confirmDraftMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  확인 후 확정 저장(모델 반영)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
