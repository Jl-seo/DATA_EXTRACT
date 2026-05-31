'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Loader2, Trash2, Save, ArrowLeft, Wand2,
    LayoutTemplate, Edit, Sliders, FileJson, FileSpreadsheet, FileText, CheckCircle2, GripVertical, Info, Layers, Plus, Split,
    Settings2, Database, Shield, Lock, Asterisk, Hash
} from 'lucide-react';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { useCreateExtractionModel, useUpdateExtractionModel, useExtractionModel, useExtractionModels, useDeleteExtractionModel } from '@/queries/extraction';
import { useMultifileUploadFeature } from '@/queries/env';
import { refineExtractionSchema } from '@/actions/extractionModel';
import { getLLMSettings } from '@/actions/llmSettings';
import { SampleAnalysisPanel } from '@/components/admin/SampleAnalysisPanel';
import { ExcelColumnEditor } from './editors/ExcelColumnEditor';
import { ReferenceDataEditor } from './editors/ReferenceDataEditor';
import { DictionaryMappingEditor } from './editors/DictionaryMappingEditor';
import { useQuery } from '@tanstack/react-query';
import { getDictionaryCategories } from '@/actions/dictionary';
import { ComparisonSettingsPanel } from './editors/ComparisonSettingsPanel';
import { SubFieldEditorModal } from './editors/SubFieldEditorModal';
import type { FieldDefinition } from '@/scheme/extractionModel';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const formSchema = z.object({
    name: z.string().min(1, '이름을 입력해주세요'),
    description: z.string().optional(),
    llm_model: z.string().optional(),
    model_type: z.enum(['extraction', 'comparison']),
    azure_model_id: z.string().optional(),
    fields: z.array(z.object({
        key: z.string().min(1, 'Key required'),
        label: z.string().min(1, 'Label required'),
        description: z.string().optional(),
        rules: z.string().optional().nullable(),
        type: z.enum(['text', 'number', 'date', 'table']),
        is_required: z.boolean().default(false).optional(),
        dictionary_id: z.string().optional().nullable(),
        validation_regex: z.string().optional().nullable(),
        sub_fields: z.any().optional().nullable(),
    })),
    global_rules: z.string().optional(),
    webhook_url: z.union([z.string().trim().url(), z.literal('')]).optional(),
    data_structure: z.enum(['data', 'table', 'report']).optional(),
    show_in_gallery: z.boolean().default(true).optional(),
    comparison_settings: z.record(z.string(), z.any()).optional().nullable(),
    excel_columns: z.array(z.record(z.string(), z.any())).optional().nullable(),
    reference_data: z.record(z.string(), z.any()).optional().nullable(),
    transformation_config: z.record(z.string(), z.any()).optional().nullable(),
    beta_features: z.object({
        use_optimized_prompt: z.boolean().optional(),
        use_virtual_excel_ocr: z.boolean().optional(),
        use_vision_extraction: z.boolean().optional(),
        vision_extraction: z.boolean().optional(),
        disable_parallel_paging: z.boolean().optional(),
        multifile_strategy: z.enum(['separate', 'merged']).optional(),
        ocr_engine: z.enum(['di', 'cu', 'vision']).optional(),
        cu_analyzer_id: z.string().optional(),
        cu_api_version: z.string().optional(),
        enable_barcode_scan: z.boolean().optional(),
        barcode_multi_scan: z.boolean().optional(),
    }).optional(),
    is_super_model: z.boolean().default(false).optional(),
    sub_model_ids: z.array(z.string()).default([]).optional(),
});

type FormValues = z.infer<typeof formSchema>;
type OcrEngineOption = 'di' | 'cu' | 'vision';

function normalizeBetaFeaturesForForm(rawBetaFeatures: unknown): FormValues['beta_features'] {
    const features = (rawBetaFeatures && typeof rawBetaFeatures === 'object' && !Array.isArray(rawBetaFeatures))
        ? rawBetaFeatures as Record<string, unknown>
        : {};

    const rawEngine = typeof features.ocr_engine === 'string' ? features.ocr_engine.trim().toLowerCase() : '';
    const isVision = rawEngine === 'vision' || features.vision_extraction === true || features.use_vision_extraction === true;
    const normalizedEngine: OcrEngineOption = isVision
        ? 'vision'
        : (rawEngine === 'cu' || rawEngine === 'content_understanding' ? 'cu' : 'di');

    return {
        ...features,
        ocr_engine: normalizedEngine,
        use_vision_extraction: isVision,
        vision_extraction: isVision,
    };
}

interface ModelEditorProps {
    modelId?: string;
    onClose?: () => void;
}

function SortableItem({ id, children, disabled }: { id: string, children: React.ReactNode, disabled?: boolean }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id, disabled });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        position: 'relative' as const,
    };

    return (
        <div ref={setNodeRef} style={style} className={clsx(isDragging && 'opacity-60 shadow-lg rounded-lg')}>
            <div className="flex gap-2 items-start">
                <div
                    className={clsx("mt-4 p-1", disabled ? "cursor-not-allowed text-muted-foreground/30" : "cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground")}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex-1 w-full min-w-0">
                    {children}
                </div>
            </div>
        </div>
    );
}

export function ModelEditor({ modelId, onClose }: ModelEditorProps) {
    const router = useRouter();
    const isEdit = !!modelId;
    const [isEditing, setIsEditing] = useState(!isEdit);
    const [activeTab, setActiveTab] = useState<'global' | 'schema' | 'data'>('global');

    const [nlCommand, setNlCommand] = useState('');
    const [isRefining, setIsRefining] = useState(false);
    const [editingSubFieldIndex, setEditingSubFieldIndex] = useState<number | null>(null);

    const { data: model, isLoading: isModelLoading } = useExtractionModel(modelId || '');
    const { data: isMultifileUploadEnabled = false } = useMultifileUploadFeature();
    const createModel = useCreateExtractionModel();
    const updateModel = useUpdateExtractionModel();
    const deleteModel = useDeleteExtractionModel();
    const { data: allModels } = useExtractionModels({ offset: 0, pageSize: 100 });
    
    const { data: dictionaryCategories } = useQuery({
        queryKey: ['dictionaryCategories'],
        queryFn: async () => await getDictionaryCategories()
    });
    const { data: llmSettings } = useQuery({
        queryKey: ['llmSettings', 'modelEditor'],
        queryFn: async () => await getLLMSettings(),
    });
    const assignedSubModelIds = (allModels || [])
        .filter(m => m.id !== modelId && m.is_super_model && m.sub_model_ids)
        .flatMap(m => m.sub_model_ids || []);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
            llm_model: '',
            model_type: 'extraction',
            fields: [],
            data_structure: 'data',
            show_in_gallery: true,
            is_super_model: false,
            sub_model_ids: [],
        },
    });
    
    // Super Model 전환 시 탭 리셋
    const isSuperModel = form.watch('is_super_model');
    useEffect(() => {
        if (isSuperModel && activeTab !== 'global') {
            setActiveTab('global');
        }
    }, [isSuperModel, activeTab]);


    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'fields',
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = fields.findIndex((f: { id: string }) => f.id === active.id);
            const newIndex = fields.findIndex((f: { id: string }) => f.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                move(oldIndex, newIndex);
            }
        }
    };

    useEffect(() => {
        if (model) {
            form.reset({
                name: model.name,
                description: model.description || '',
                llm_model: model.llm_model || '',
                model_type: model.model_type,
                azure_model_id: model.azure_model_id || '',
                fields: model.fields.map(f => ({
                    key: f.key,
                    label: f.label,
                    description: f.description || '',
                    type: f.type,
                    rules: f.rules || '',
                    is_required: f.is_required || false,
                    dictionary_id: f.dictionary_id || '',
                    validation_regex: f.validation_regex || '',
                    sub_fields: f.sub_fields || [],
                })),
                global_rules: model.global_rules || '',
                webhook_url: model.webhook_url || '',
                data_structure: (model.data_structure as any) || 'data',
                show_in_gallery: model.show_in_gallery ?? true,
                comparison_settings: model.comparison_settings,
                excel_columns: model.excel_columns,
                reference_data: model.reference_data,
                transformation_config: model.transformation_config,
                beta_features: normalizeBetaFeaturesForForm(model.beta_features),
                is_super_model: model.is_super_model || false,
                sub_model_ids: model.sub_model_ids || [],
            });
        }
    }, [model, form]);

    const onSubmit = async (data: FormValues) => {
        try {
            const normalizedBetaFeatures = data.beta_features
                ? normalizeBetaFeaturesForForm(data.beta_features)
                : undefined;
            const normalizedData: FormValues = {
                ...data,
                llm_model: data.llm_model?.trim() || undefined,
                beta_features: normalizedBetaFeatures,
            };

            if (isEdit && modelId) {
                await updateModel.mutateAsync({
                    id: modelId,
                    ...normalizedData,
                });
                toast.success('모델이 수정되었습니다.');
                setIsEditing(false);
            } else {
                await createModel.mutateAsync(normalizedData);
                toast.success('모델이 생성되었습니다.');
                router.refresh(); // Refresh RSC so AuthContext gets updated modelRoles
                if (onClose) {
                    onClose();
                } else {
                    router.push('/admin/model-studio');
                }
            }
        } catch (error) {
            console.error(error);
            toast.error('저장에 실패했습니다.');
        }
    };

    const onInvalid = () => {
        const firstErrorMessage = Object.values(form.formState.errors).find((error) => {
            return typeof error?.message === 'string' && error.message.length > 0;
        })?.message;

        if (typeof firstErrorMessage === 'string') {
            toast.error(`입력값을 확인해주세요: ${firstErrorMessage}`);
            return;
        }

        toast.error('입력값을 확인해주세요.');
    };

    const handleCancel = () => {
        if (isEdit) {
            if (model) {
                form.reset({
                    name: model.name,
                    description: model.description || '',
                    llm_model: model.llm_model || '',
                    model_type: model.model_type,
                    azure_model_id: model.azure_model_id || '',
                    fields: model.fields.map(f => ({
                        key: f.key,
                        label: f.label,
                        description: f.description || '',
                        type: f.type,
                        rules: f.rules || '',
                        is_required: f.is_required || false,
                        dictionary_id: f.dictionary_id || '',
                        validation_regex: f.validation_regex || '',
                        sub_fields: f.sub_fields || [],
                    })),
                    global_rules: model.global_rules || '',
                    webhook_url: model.webhook_url || '',
                    data_structure: (model.data_structure as any) || 'data',
                    show_in_gallery: model.show_in_gallery ?? true,
                    comparison_settings: model.comparison_settings,
                    excel_columns: model.excel_columns,
                    reference_data: model.reference_data,
                    transformation_config: model.transformation_config,
                    beta_features: normalizeBetaFeaturesForForm(model.beta_features),
                    is_super_model: model.is_super_model || false,
                    sub_model_ids: model.sub_model_ids || [],
                });
            }
            setIsEditing(false);
        } else {
            if (onClose) {
                onClose();
            } else {
                router.back();
            }
        }
    };

    const handleDelete = async () => {
        if (!modelId) return;
        try {
            await deleteModel.mutateAsync(modelId);
            toast.success('모델이 삭제되었습니다.');
            router.refresh();
            if (onClose) {
                onClose();
            } else {
                router.replace('/admin/model-studio');
            }
        } catch (error) {
            console.error(error);
            toast.error('삭제에 실패했습니다.');
        }
    };

    const watchedOcrEngine = form.watch('beta_features.ocr_engine');
    const watchedVisionExtraction = form.watch('beta_features.use_vision_extraction');
    const watchedLegacyVisionExtraction = form.watch('beta_features.vision_extraction');
    const selectedOcrEngine: OcrEngineOption =
        watchedOcrEngine === 'vision' || watchedVisionExtraction === true || watchedLegacyVisionExtraction === true
            ? 'vision'
            : (watchedOcrEngine === 'cu' ? 'cu' : 'di');

    const handleRefineSchema = async () => {
        if (!nlCommand) return;
        setIsRefining(true);
        try {
            const currentFields = form.getValues('fields');
            console.log('[ModelEditor] Refining schema with command:', nlCommand);
            console.log('[ModelEditor] Current fields:', currentFields);
            
            const refinedFields = await refineExtractionSchema(currentFields, nlCommand);
            console.log('[ModelEditor] Refined fields received:', refinedFields);

            // Update form fields with new schema
            form.setValue('fields', refinedFields.map((f: any) => ({
                key: f.key,
                label: f.label,
                description: f.description || '',
                type: f.type,
                rules: f.rules || '',
                is_required: f.is_required || false,
                dictionary_id: f.dictionary_id || '',
                validation_regex: f.validation_regex || '',
                sub_fields: f.sub_fields || [],
            })), { shouldDirty: true });

            toast.success('스키마가 AI에 의해 수정되었습니다.');
            setNlCommand('');
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || '스키마 수정 실패');
        } finally {
            setIsRefining(false);
        }
    };

    const handleFieldsFound = (foundFields: FieldDefinition[]) => {
        const currentFields = form.watch('fields') || [];
        const newFields = foundFields
            .filter(f => !currentFields.some(curr => curr.key === f.key))
            .map(f => ({
                key: f.key,
                label: f.label,
                description: f.description || '',
                type: f.type,
                rules: f.rules || '',
                is_required: f.is_required || false,
                dictionary_id: f.dictionary_id || '',
                validation_regex: f.validation_regex || '',
                sub_fields: [],
            }));

        form.setValue('fields', [...currentFields, ...newFields]);
    };

    if (isEdit && isModelLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-80px)] flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 font-sans text-sm p-6">
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                {/* Header */}
                <header className="flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => onClose ? onClose() : router.back()}
                            className="p-1.5 bg-card hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg shadow-sm border border-border transition-all active:scale-95"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex flex-col">
                            <input
                                type="text"
                                {...form.register('name')}
                                disabled={!isEditing}
                                className={clsx(
                                    "text-lg font-black text-foreground bg-transparent border-none outline-none px-0",
                                    !isEditing && "cursor-default"
                                )}
                                placeholder="모델 이름"
                            />
                            <span className="text-[10px] text-muted-foreground">
                                {isEditing ? "편집 중" : "읽기 전용"}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <>
                                <Button variant="ghost" size="sm" onClick={handleCancel}>
                                    취소
                                </Button>
                                <Button size="sm" onClick={form.handleSubmit(onSubmit, onInvalid)} disabled={createModel.isPending || updateModel.isPending}>
                                    {(createModel.isPending || updateModel.isPending) && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                                    <Save className="w-3.5 h-3.5 mr-1" />
                                    저장
                                </Button>
                            </>
                        ) : (
                            <>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="destructive" className="mr-2">
                                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                                            삭제
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                이 작업은 되돌릴 수 없습니다. 삭제된 모델은 복구할 수 없습니다.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                                {deleteModel.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                                삭제
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                <Button size="sm" onClick={() => setIsEditing(true)}>
                                    <Edit className="w-3.5 h-3.5 mr-1" />
                                    편집
                                </Button>
                            </>
                        )}
                    </div>
                </header>

                {/* Tabs */}
                <div className="flex gap-1 bg-muted p-1 rounded-lg shrink-0">
                    <button
                        onClick={() => setActiveTab('global')}
                        className={clsx(
                            "flex-1 px-4 py-2 rounded-md text-xs font-bold transition-all",
                            activeTab === 'global'
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Settings2 className="w-4 h-4" />
                            <span>모델 전역 설정</span>
                        </div>
                    </button>
                    {!isSuperModel && (
                        <>
                            <button
                                onClick={() => setActiveTab('schema')}
                                className={clsx(
                                    "flex-1 px-4 py-2 rounded-md text-xs font-bold transition-all",
                                    activeTab === 'schema'
                                        ? "bg-card text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    <span>추출 스키마</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('data')}
                                className={clsx(
                                    "flex-1 px-4 py-2 rounded-md text-xs font-bold transition-all",
                                    activeTab === 'data'
                                        ? "bg-card text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Database className="w-4 h-4" />
                                    <span>데이터 & 딕셔너리</span>
                                </div>
                            </button>
                        </>
                    )}
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                    {activeTab === 'global' && (
                        <>

                            {/* Super Model Toggle */}
                            <Card className="shadow-sm border-muted-foreground/20 overflow-hidden">
                                <CardHeader className="py-2 px-4 flex-row items-center justify-between space-y-0">
                                    <div className="flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-primary" />
                                        <CardTitle className="text-sm font-bold">상위 모델 (Super Model)</CardTitle>
                                    </div>
                                    <div
                                        className={clsx(
                                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                                            form.watch('is_super_model') ? "bg-primary" : "bg-muted",
                                            !isEditing && "opacity-50 cursor-not-allowed"
                                        )}
                                        onClick={() => isEditing && form.setValue('is_super_model', !form.watch('is_super_model'))}
                                    >
                                        <span
                                            className={clsx(
                                                "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                                                form.watch('is_super_model') ? "translate-x-4" : "translate-x-0.5"
                                            )}
                                        />
                                    </div>
                                </CardHeader>
                                {form.watch('is_super_model') && (
                                    <CardContent className="px-4 py-4 space-y-4">
                                        <div className="space-y-2">
                                            <Label className="text-xs font-semibold">연결할 하위 모델 선택</Label>
                                            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                                                {allModels?.filter(m =>
                                                    m.id !== modelId &&
                                                    !m.is_super_model &&
                                                    (!assignedSubModelIds.includes(m.id) || (form.watch('sub_model_ids') || []).includes(m.id))
                                                ).map((m) => {
                                                    const isChecked = (form.watch('sub_model_ids') || []).includes(m.id);
                                                    return (
                                                        <div
                                                            key={m.id}
                                                            onClick={() => {
                                                                if (!isEditing) return;
                                                                const current = form.getValues('sub_model_ids') || [];
                                                                if (isChecked) {
                                                                    form.setValue('sub_model_ids', current.filter(id => id !== m.id));
                                                                } else {
                                                                    form.setValue('sub_model_ids', [...current, m.id]);
                                                                }
                                                            }}
                                                            className={clsx(
                                                                "flex items-center justify-between p-3 rounded-lg border-2 transition-all cursor-pointer",
                                                                isChecked ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:bg-muted/50"
                                                            )}
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-xs font-bold">{m.name}</span>
                                                                <span className="text-[10px] text-muted-foreground line-clamp-1">{m.description || '설명 없음'}</span>
                                                            </div>
                                                            <div className={clsx(
                                                                "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                                                isChecked ? "bg-primary border-primary text-white" : "border-border"
                                                            )}>
                                                                {isChecked && <CheckCircle2 className="w-3 h-3" />}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {(!allModels || allModels.filter(m =>
                                                    m.id !== modelId &&
                                                    !m.is_super_model &&
                                                    (!assignedSubModelIds.includes(m.id) || (form.watch('sub_model_ids') || []).includes(m.id))
                                                ).length === 0) && (
                                                        <div className="text-center py-4 text-xs text-muted-foreground">
                                                            선택 가능한 하위 모델이 없습니다.
                                                        </div>
                                                    )}
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">
                                                * 상위 모델은 다른 상위 모델을 포함할 수 없습니다.
                                            </p>
                                        </div>
                                    </CardContent>
                                )}
                            </Card>

                            {!form.watch('is_super_model') && (
                                <>
                                    {/* Model Type Selection */}
                                    <Card className="shadow-sm border-muted-foreground/20 overflow-hidden">
                                        <CardHeader className="py-2 px-4 flex-row items-center gap-2 space-y-0">
                                            <Sliders className="w-4 h-4 text-primary" />
                                            <CardTitle className="text-sm font-bold">모델 유형</CardTitle>
                                        </CardHeader>
                                        <CardContent className="px-4 py-2">
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => isEditing && form.setValue('model_type', 'extraction')}
                                                    disabled={!isEditing}
                                                    className={clsx(
                                                        "flex-1 px-4 py-3 rounded-lg border-2 text-left transition-all",
                                                        (!form.watch('model_type') || form.watch('model_type') === 'extraction')
                                                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                            : "border-border hover:border-primary/50 hover:bg-muted/50",
                                                        !isEditing && "cursor-not-allowed opacity-60"
                                                    )}
                                                >
                                                    <div className="font-bold text-sm mb-1">📄 일반 추출 (Extraction)</div>
                                                    <div className="text-xs text-muted-foreground">문서에서 텍스트와 데이터를 추출합니다.</div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => isEditing && form.setValue('model_type', 'comparison')}
                                                    disabled={!isEditing}
                                                    className={clsx(
                                                        "flex-1 px-4 py-3 rounded-lg border-2 text-left transition-all",
                                                        form.watch('model_type') === 'comparison'
                                                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                                            : "border-border hover:border-primary/50 hover:bg-muted/50",
                                                        !isEditing && "cursor-not-allowed opacity-60"
                                                    )}
                                                >
                                                    <div className="font-bold text-sm mb-1">⚖️ 비교 분석 (Comparison)</div>
                                                    <div className="text-xs text-muted-foreground">두 이미지/문서 간의 차이점을 분석합니다.</div>
                                                </button>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {form.watch('model_type') === 'comparison' && (
                                        <div className="space-y-4">
                                            <ComparisonSettingsPanel
                                                settings={form.watch('comparison_settings') as any}
                                                onChange={(settings) => isEditing && form.setValue('comparison_settings', settings)}
                                                disabled={!isEditing}
                                            />
                                            <ExcelColumnEditor
                                                columns={form.watch('excel_columns') as any}
                                                onChange={(columns) => isEditing && form.setValue('excel_columns', columns)}
                                                disabled={!isEditing}
                                            />
                                        </div>
                                    )}
                                </>
                            )}



                            {/* Advanced Settings */}
                            <Card className="shadow-sm border-muted-foreground/20 overflow-hidden">
                                <CardHeader className="py-2 px-4 flex-row items-center gap-2 space-y-0">
                                    <Sliders className="w-4 h-4 text-primary" />
                                    <CardTitle className="text-sm font-bold">
                                        {form.watch('model_type') === 'comparison' ? '비교 규칙 설정 (Comparison Rules)' : '고급 설정'}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 py-2 space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs font-semibold flex items-center gap-1 mb-2">
                                            {form.watch('model_type') === 'comparison' ? '비교 세부 지침' : '전역 보정 규칙 (Global Rules)'}
                                            <Info className="w-3 h-3 text-muted-foreground" />
                                        </Label>

                                        {isEditing && (
                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {[
                                                    "폰트 크기 및 스타일 차이 무시",
                                                    "단순 텍스트 내용만 엄격하게 비교",
                                                    "레이아웃 위치 변경은 허용",
                                                    "이미지나 아이콘은 비교 제외",
                                                    "로고 유무 필수 확인"
                                                ].map((rule) => (
                                                    <button
                                                        key={rule}
                                                        type="button"
                                                        onClick={() => {
                                                            const current = form.getValues('global_rules') || "";
                                                            const newValue = current ? `${current}\n- ${rule}` : `- ${rule}`;
                                                            form.setValue('global_rules', newValue, { shouldValidate: true, shouldDirty: true });
                                                        }}
                                                        className="text-[10px] px-2 py-1 bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 rounded-full transition-colors"
                                                    >
                                                        + {rule}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <textarea
                                            {...form.register('global_rules')}
                                            disabled={!isEditing}
                                            placeholder={form.watch('model_type') === 'comparison'
                                                ? '예: "두 문서 간의 텍스트 오타와 수치 차이점만 찾아줘. 레이아웃이나 스타일 차이는 무시해."'
                                                : "모든 필드 추출 시 공통적으로 적용할 규칙을 입력하세요 (예: 날짜 형식 YYYY-MM-DD)"}
                                            className="w-full min-h-32 px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring transition-all resize-y bg-background"
                                        />
                                        <div className="flex justify-between items-start mt-1">
                                            <p className="text-[10px] text-muted-foreground">
                                                {form.watch('model_type') === 'comparison'
                                                    ? "* 비교 시 LLM이 중점적으로 확인해야 할 사항을 자연어로 입력하세요."
                                                    : "* 특정 필드에 국한되지 않는 전역적인 추출 지침을 AI에게 전달합니다."}
                                            </p>
                                            {isEditing && (
                                                <span
                                                    className="text-[10px] text-primary cursor-pointer hover:underline shrink-0"
                                                    onClick={() => form.setValue('global_rules', '', { shouldValidate: true, shouldDirty: true })}
                                                >
                                                    초기화
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs">🔗 Webhook URL (추출 완료 시 POST 전송)</Label>
                                        <Input
                                            {...form.register('webhook_url')}
                                            disabled={!isEditing}
                                            placeholder="https://your-automation-endpoint.com/webhook"
                                            className="text-xs"
                                        />
                                        <p className="text-[10px] text-muted-foreground">
                                            추출 확정 시 이 URL로 결과 데이터가 POST 됩니다.
                                        </p>
                                    </div>

                                    {/* Beta Features - Only for extraction models */}
                                    {form.watch('model_type') !== 'comparison' && (
                                        <div className="pt-4 border-t border-border space-y-4">
                                            <div className="space-y-2">
                                                <Label className="text-xs font-semibold">OCR 엔진 선택</Label>
                                                <Select
                                                    value={selectedOcrEngine}
                                                    onValueChange={(val: OcrEngineOption) => {
                                                        if (!isEditing) return;
                                                        form.setValue('beta_features.ocr_engine', val, { shouldDirty: true });
                                                        form.setValue('beta_features.use_vision_extraction', val === 'vision', { shouldDirty: true });
                                                        form.setValue('beta_features.vision_extraction', val === 'vision', { shouldDirty: true });
                                                    }}
                                                    disabled={!isEditing}
                                                >
                                                    <SelectTrigger className="h-10 text-xs bg-background">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="di">DI (Document Intelligence)</SelectItem>
                                                        <SelectItem value="cu">CU (Content Understanding)</SelectItem>
                                                        <SelectItem value="vision">Vision (멀티모달)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <p className="text-[10px] text-muted-foreground">
                                                    Vision 선택 시 OCR 대신 멀티모달 이미지 추출 파이프라인으로 처리됩니다.
                                                </p>
                                            </div>

                                            {selectedOcrEngine === 'cu' && (
                                                <div className="space-y-3 rounded-lg border border-amber-300/40 bg-amber-50/40 p-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs font-semibold">CU Analyzer ID</Label>
                                                        <Input
                                                            value={form.watch('beta_features.cu_analyzer_id') || ''}
                                                            onChange={(e) => isEditing && form.setValue('beta_features.cu_analyzer_id', e.target.value)}
                                                            disabled={!isEditing}
                                                            placeholder="예: extraction-table-v1"
                                                            className="text-xs"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs font-semibold">CU API Version (선택)</Label>
                                                        <Input
                                                            value={form.watch('beta_features.cu_api_version') || ''}
                                                            onChange={(e) => isEditing && form.setValue('beta_features.cu_api_version', e.target.value)}
                                                            disabled={!isEditing}
                                                            placeholder="기본값: env.content_understanding.api_version"
                                                            className="text-xs"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                                                <Label className="text-xs font-semibold">모델별 LLM 설정</Label>
                                                <Select
                                                    value={form.watch('llm_model') || '__GLOBAL__'}
                                                    onValueChange={(value) => {
                                                        if (!isEditing) return;
                                                        form.setValue('llm_model', value === '__GLOBAL__' ? '' : value, { shouldDirty: true });
                                                    }}
                                                    disabled={!isEditing}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="전역 모델 사용" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__GLOBAL__">전역 모델 사용</SelectItem>
                                                        {(llmSettings?.available_models || []).map((deploymentName) => (
                                                            <SelectItem key={deploymentName} value={deploymentName}>
                                                                {deploymentName}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <p className="text-[10px] text-muted-foreground">
                                                    선택하지 않으면 전역 LLM 설정을 사용합니다.
                                                </p>
                                            </div>

                                            {/* Optimized Prompt Toggle */}
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-medium text-foreground">🚀 [Beta] 최적화 프롬프트 사용</span>
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/10 text-indigo-500 font-bold border border-indigo-500/20">BETA</span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[300px]">
                                                        OCR 위치 좌표를 제외하고 인덱스 태그로 참조하여 토큰 비용을 절감하고 복잡한 문서 인식률을 향상시킵니다.
                                                    </p>
                                                </div>
                                                <div
                                                    className={clsx(
                                                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                                                        form.watch('beta_features.use_optimized_prompt') ? "bg-indigo-500" : "bg-muted-foreground/30",
                                                        !isEditing && "opacity-50 cursor-not-allowed"
                                                    )}
                                                    onClick={() => isEditing && form.setValue('beta_features.use_optimized_prompt', !form.watch('beta_features.use_optimized_prompt'))}
                                                >
                                                    <span
                                                        className={clsx(
                                                            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                                                            form.watch('beta_features.use_optimized_prompt') ? "translate-x-4" : "translate-x-0.5"
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            {/* Disable Parallel Paging Toggle */}
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-medium text-foreground">🔁 병렬 페이징 비활성화</span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[300px]">
                                                        대형 테이블(15행+) 추출 시 병렬 분할을 끄고 단일 샷으로 처리합니다. 행 순서가 중요하거나 컨텍스트 손실이 우려될 때 사용하세요.
                                                    </p>
                                                </div>
                                                <div
                                                    className={clsx(
                                                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                                                        form.watch('beta_features.disable_parallel_paging') ? "bg-orange-500" : "bg-muted-foreground/30",
                                                        !isEditing && "opacity-50 cursor-not-allowed"
                                                    )}
                                                    onClick={() => isEditing && form.setValue('beta_features.disable_parallel_paging', !form.watch('beta_features.disable_parallel_paging'))}
                                                >
                                                    <span
                                                        className={clsx(
                                                            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                                                            form.watch('beta_features.disable_parallel_paging') ? "translate-x-4" : "translate-x-0.5"
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            {isMultifileUploadEnabled && (
                                                <div className="space-y-2 pt-1">
                                                    <Label className="text-xs font-semibold">다중문서 추출 기본 전략</Label>
                                                    <Select
                                                        value={form.watch('beta_features.multifile_strategy') || 'separate'}
                                                        onValueChange={(value: 'separate' | 'merged') => isEditing && form.setValue('beta_features.multifile_strategy', value)}
                                                        disabled={!isEditing}
                                                    >
                                                        <SelectTrigger className="h-10 text-xs bg-background">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="separate">개별 추출 (파일별 로그)</SelectItem>
                                                            <SelectItem value="merged">통합 추출 (단일 로그)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="text-[10px] text-muted-foreground">
                                                        다중문서 업로드 시 기본으로 사용할 처리 전략입니다.
                                                    </p>
                                                </div>
                                            )}

                                            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-medium text-foreground">📷 바코드 스캔 사용</span>
                                                        </div>
                                                        <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[300px]">
                                                            업로드 화면에 바코드 스캔 버튼을 노출합니다.
                                                        </p>
                                                    </div>
                                                    <div
                                                        className={clsx(
                                                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                                                            form.watch('beta_features.enable_barcode_scan') ? "bg-emerald-500" : "bg-muted-foreground/30",
                                                            !isEditing && "opacity-50 cursor-not-allowed"
                                                        )}
                                                        onClick={() => isEditing && form.setValue('beta_features.enable_barcode_scan', !form.watch('beta_features.enable_barcode_scan'))}
                                                    >
                                                        <span
                                                            className={clsx(
                                                                "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                                                                form.watch('beta_features.enable_barcode_scan') ? "translate-x-4" : "translate-x-0.5"
                                                            )}
                                                        />
                                                    </div>
                                                </div>

                                                {form.watch('beta_features.enable_barcode_scan') && (
                                                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-medium text-foreground">🔁 기본 멀티 스캔</span>
                                                            </div>
                                                            <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[300px]">
                                                                활성화 시 스캐너가 멀티 인식 모드로 시작됩니다.
                                                            </p>
                                                        </div>
                                                        <div
                                                            className={clsx(
                                                                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                                                                form.watch('beta_features.barcode_multi_scan') ? "bg-cyan-500" : "bg-muted-foreground/30",
                                                                !isEditing && "opacity-50 cursor-not-allowed"
                                                            )}
                                                            onClick={() => isEditing && form.setValue('beta_features.barcode_multi_scan', !form.watch('beta_features.barcode_multi_scan'))}
                                                        >
                                                            <span
                                                                className={clsx(
                                                                    "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                                                                    form.watch('beta_features.barcode_multi_scan') ? "translate-x-4" : "translate-x-0.5"
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                        </div>
                                    )}

                                    {/* Gallery Visibility Toggle */}
                                    <div className="pt-4 border-t border-muted-foreground/10 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label className="text-xs font-semibold flex items-center gap-1">
                                                    👁️ 모델 갤러리 노출
                                                    <Info className="w-3 h-3 text-muted-foreground" />
                                                </Label>
                                                <p className="text-[10px] text-muted-foreground">
                                                    비활성화하면 모델 갤러리(사용자 화면)에서 숨겨집니다.
                                                </p>
                                            </div>
                                            <div
                                                className={clsx(
                                                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                                    form.watch('show_in_gallery') ? "bg-primary" : "bg-muted",
                                                    !isEditing && "opacity-50 cursor-not-allowed"
                                                )}
                                                onClick={() => isEditing && form.setValue('show_in_gallery', !form.watch('show_in_gallery'))}
                                            >
                                                <span
                                                    className={clsx(
                                                        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                                                        form.watch('show_in_gallery') ? "translate-x-4" : "translate-x-0.5"
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}

                    {activeTab === 'schema' && (
                        <div className="flex flex-col gap-3 pr-2">
                            {/* Sample Analysis Panel */}
                            {isEditing && form.watch('model_type') !== 'comparison' && (
                                <SampleAnalysisPanel
                                    onFieldsFound={handleFieldsFound}
                                    disabled={!isEditing}
                                />
                            )}

                            {/* Natural Language Command Center */}
                            {form.watch('model_type') !== 'comparison' && (
                                <div className="relative p-[2px] rounded-xl bg-linear-to-r from-primary via-chart-5 to-chart-3 animate-gradient-xy shrink-0">
                                    <div className="bg-card rounded-xl p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <div className="bg-linear-to-r from-primary to-chart-5 p-2 rounded-lg">
                                                    <Wand2 className="w-4 h-4 text-primary-foreground" />
                                                </div>
                                                <h3 className="font-bold text-base text-foreground">자연어 명령 센터</h3>
                                            </div>
                                            {isEditing && (
                                                <Button
                                                    size="sm"
                                                    onClick={handleRefineSchema}
                                                    disabled={isRefining || !nlCommand}
                                                    className="bg-primary hover:bg-primary/90"
                                                >
                                                    {isRefining ? (
                                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                                                    ) : (
                                                        <Wand2 className="w-3.5 h-3.5 mr-1" />
                                                    )}
                                                    실행 (Execute)
                                                </Button>
                                            )}
                                        </div>
                                        <textarea
                                            value={nlCommand}
                                            onChange={(e) => setNlCommand(e.target.value)}
                                            disabled={!isEditing}
                                            placeholder="예: '송장번호 키를 invoice_id로 바꾸고 타입 숫자로 변경해', '할인율 필드 제거해'..."
                                            className={clsx(
                                                "w-full h-24 px-4 py-3 text-sm border-2 border-primary/20 focus:border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all resize-none bg-background",
                                                !isEditing && "bg-muted cursor-not-allowed"
                                            )}
                                        />
                                        <p className="mt-2 text-[10px] text-muted-foreground text-right">
                                            * 현재 필드들을 AI가 분석하여 명령을 수행합니다.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Extraction Fields */}
                            {form.watch('model_type') === 'comparison' ? (
                                <div className="space-y-4">
                                    <ComparisonSettingsPanel
                                        settings={form.watch('comparison_settings') as any}
                                        onChange={(settings) => isEditing && form.setValue('comparison_settings', settings)}
                                        disabled={!isEditing}
                                    />
                                    <ExcelColumnEditor
                                        columns={form.watch('excel_columns') as any}
                                        onChange={(columns) => isEditing && form.setValue('excel_columns', columns)}
                                        disabled={!isEditing}
                                    />
                                </div>
                            ) : (
                                <>
                                    <Card className="shadow-sm border-muted-foreground/20 overflow-hidden">
                                        <CardHeader className="py-2 px-4 flex-row items-center gap-2 space-y-0">
                                            <LayoutTemplate className="w-4 h-4 text-primary" />
                                            <CardTitle className="text-sm font-bold">추출 필드</CardTitle>
                                        </CardHeader>
                                        <CardContent className="px-4 py-2">
                                            <DndContext
                                                sensors={sensors}
                                                collisionDetection={closestCenter}
                                                onDragEnd={handleDragEnd}
                                            >
                                                <SortableContext items={fields.map((f: any) => f.id)} strategy={verticalListSortingStrategy}>
                                                    <div className="space-y-3">
                                                        {/* Fields — 카드 레이아웃 */}
                                                        {fields.map((field: any, index: number) => (
                                                            <SortableItem key={field.id} id={field.id} disabled={!isEditing}>
                                                                <div className="p-4 bg-muted/20 rounded-xl border border-border/50 shadow-sm space-y-4 hover:border-primary/30 transition-colors">
                                                                    <div className="grid grid-cols-12 gap-6">
                                                                        {/* Col 1: 필드 및 설명 */}
                                                                        <div className="col-span-12 md:col-span-5 space-y-3">
                                                                            <div className="flex items-center justify-between">
                                                                                <div className="flex items-center gap-2">
                                                                                    {/* <Hash className="w-3.5 h-3.5 text-muted-foreground" /> */}
                                                                                    <span className="text-[10px] font-black tracking-tight text-foreground/80">KEY (필드명)</span>
                                                                                </div>
                                                                                {isEditing && (
                                                                                    <Button
                                                                                        type="button"
                                                                                        variant="ghost"
                                                                                        size="icon"
                                                                                        className="h-6 w-6 text-destructive/50 hover:text-destructive hover:bg-destructive/10 -mr-1"
                                                                                        onClick={() => remove(index)}
                                                                                    >
                                                                                        <Trash2 className="w-3 h-3" />
                                                                                    </Button>
                                                                                )}
                                                                            </div>
                                                                            <Input
                                                                                {...form.register(`fields.${index}.key`)}
                                                                                placeholder="invoice_number"
                                                                                disabled={!isEditing}
                                                                                className="h-10 text-xs font-mono bg-background focus:ring-1 focus:ring-primary/20"
                                                                            />

                                                                            <div className="space-y-1.5 pt-1">
                                                                                <span className="text-[10px] font-black tracking-tight text-foreground/80">PROMPT / DESCRIPTION (추출 가이드)</span>
                                                                                <Textarea
                                                                                    {...form.register(`fields.${index}.label`)}
                                                                                    placeholder="Unique identifier for the invoice..."
                                                                                    disabled={!isEditing}
                                                                                    className="text-xs min-h-[100px] bg-background resize-none leading-relaxed"
                                                                                />
                                                                            </div>
                                                                        </div>

                                                                        {/* Col 2: 타입 및 규칙 (Transformation) */}
                                                                        <div className="col-span-12 md:col-span-4 space-y-3 border-x-0 md:border-x border-border/40 px-0 md:px-6">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[10px] font-black tracking-tight text-foreground/80 uppercase">타입 및 규칙 (Transformation)</span>
                                                                            </div>

                                                                            <div className="flex items-center gap-2">
                                                                                <div className="p-2 bg-muted rounded-lg shrink-0">
                                                                                    <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                                                                                </div>
                                                                                <Select
                                                                                    value={form.watch(`fields.${index}.type`)}
                                                                                    onValueChange={(val: any) => isEditing && form.setValue(`fields.${index}.type`, val)}
                                                                                    disabled={!isEditing}
                                                                                >
                                                                                    <SelectTrigger className="h-10 text-xs bg-background">
                                                                                        <SelectValue />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="text">Text</SelectItem>
                                                                                        <SelectItem value="number">Number</SelectItem>
                                                                                        <SelectItem value="date">Date</SelectItem>
                                                                                        <SelectItem value="table">Table</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            </div>

                                                                            {form.watch(`fields.${index}.type`) === 'table' ? (
                                                                                <div className="pt-2">
                                                                                    <Button
                                                                                        type="button"
                                                                                        variant="outline"
                                                                                        onClick={() => setEditingSubFieldIndex(index)}
                                                                                        disabled={!isEditing}
                                                                                        className="w-full flex justify-between h-10 border-input text-foreground bg-background hover:bg-muted font-normal text-xs"
                                                                                    >
                                                                                        <div className="flex items-center gap-2">
                                                                                            <Split className="w-4 h-4 text-muted-foreground rotate-90" />
                                                                                            <span>서브 필드 설정</span>
                                                                                        </div>
                                                                                        {form.watch(`fields.${index}.sub_fields`)?.length > 0 && (
                                                                                            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold">
                                                                                                {form.watch(`fields.${index}.sub_fields`)?.length}개 열
                                                                                            </span>
                                                                                        )}
                                                                                    </Button>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="space-y-1.5 pt-2">
                                                                                    <span className="text-[10px] font-black tracking-tight text-foreground/80 uppercase">Rules (변환 규칙/예외 처리)</span>
                                                                                    <Input
                                                                                        {...form.register(`fields.${index}.rules`)}
                                                                                        placeholder="예: 소수점 2자리까지만 추출"
                                                                                        disabled={!isEditing}
                                                                                        className="h-10 text-xs bg-background"
                                                                                    />
                                                                                </div>
                                                                            )}

                                                                            <div className="space-y-1.5 pt-2">
                                                                                <span className="text-[10px] font-black tracking-tight text-foreground/80 uppercase">Dictionary (정규화 사전)</span>
                                                                                <div className="flex items-center gap-2">
                                                                                    <Select 
                                                                                        value={form.watch(`fields.${index}.dictionary_id`) || "none"}
                                                                                        onValueChange={(val) => form.setValue(`fields.${index}.dictionary_id`, val === "none" ? null : val)}
                                                                                        disabled={!isEditing}
                                                                                    >
                                                                                        <SelectTrigger className="w-full h-10 text-xs bg-background">
                                                                                            <SelectValue placeholder="사전 선택 안됨" />
                                                                                        </SelectTrigger>
                                                                                        <SelectContent>
                                                                                            <SelectItem value="none">사용 안함 (매핑 없음)</SelectItem>
                                                                                            {dictionaryCategories?.map(cat => (
                                                                                                <SelectItem key={cat.category} value={cat.category}>{cat.category}</SelectItem>
                                                                                            ))}
                                                                                        </SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Col 3: 추가 옵션 */}
                                                                        <div className="col-span-12 md:col-span-3 space-y-4">
                                                                            <span className="text-[10px] font-black tracking-tight text-foreground/80 uppercase">추가 옵션</span>

                                                                            <div className="space-y-2.5">
                                                                                <div className="flex items-center space-x-2">
                                                                                    <div
                                                                                        className={clsx(
                                                                                            "h-4 w-4 rounded border transition-colors flex items-center justify-center cursor-pointer",
                                                                                            form.watch(`fields.${index}.is_required`) ? "bg-primary border-primary" : "border-border bg-background"
                                                                                        )}
                                                                                        onClick={() => isEditing && form.setValue(`fields.${index}.is_required`, !form.watch(`fields.${index}.is_required`))}
                                                                                    >
                                                                                        {form.watch(`fields.${index}.is_required`) && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                                                                                    </div>
                                                                                    <label className="text-xs text-muted-foreground">필수 수집 (Required)</label>
                                                                                </div>

                                                                            </div>

                                                                            <div className="space-y-1.5 pt-2">
                                                                                <span className="text-[10px] font-black tracking-tight text-foreground/80 uppercase">검증 규칙 (REGEX)</span>
                                                                                <div className="relative">
                                                                                    <Input
                                                                                        {...form.register(`fields.${index}.validation_regex`)}
                                                                                        placeholder="^ ..."
                                                                                        disabled={!isEditing}
                                                                                        className="h-10 text-xs font-mono bg-background pl-3 pr-8"
                                                                                    />
                                                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground">$/</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </SortableItem>
                                                        ))}

                                                        {/* Add Field Button */}
                                                        {isEditing && (
                                                            <button
                                                                type="button"
                                                                onClick={() => append({ key: '', label: '', description: '', rules: '', type: 'text', is_required: false, dictionary_id: '', validation_regex: '', sub_fields: [] })}
                                                                className="mt-3 w-full py-2 border-2 border-dashed border-border hover:border-primary text-muted-foreground hover:text-primary rounded-lg text-xs font-medium transition-all"
                                                            >
                                                                + 필드 추가
                                                            </button>
                                                        )}

                                                        {fields.length === 0 && (
                                                            <div className="text-center py-8 text-muted-foreground text-xs">
                                                                필드가 없습니다. 필드 추가를 눌러 시작하세요.
                                                            </div>
                                                        )}
                                                    </div>
                                                </SortableContext>
                                            </DndContext>
                                        </CardContent>
                                    </Card>

                                    {/* Sub Field Editor Modal */}
                                    {editingSubFieldIndex !== null && (
                                        <SubFieldEditorModal
                                            isOpen={true}
                                            onClose={() => setEditingSubFieldIndex(null)}
                                            onSave={(subFields) => {
                                                if (editingSubFieldIndex !== null) {
                                                    form.setValue(`fields.${editingSubFieldIndex}.sub_fields`, subFields as any, { shouldDirty: true });
                                                    setEditingSubFieldIndex(null);
                                                }
                                            }}
                                            initialData={form.watch(`fields.${editingSubFieldIndex}.sub_fields`) as any}
                                            dictionaryCategories={dictionaryCategories}
                                        />
                                    )}

                                </>
                            )}
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <div className="flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2 pb-10">
                            {/* Reference Data Edit */}
                            {form.watch('model_type') !== 'comparison' && (
                                <ReferenceDataEditor
                                    value={form.watch('reference_data') as any}
                                    onChange={(data) => isEditing && form.setValue('reference_data', data)}
                                    disabled={!isEditing}
                                />
                            )}

                            {/* Dictionary Mapping UI */}
                            {form.watch('model_type') !== 'comparison' && (
                                <DictionaryMappingEditor />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
