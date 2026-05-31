import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { clsx } from 'clsx';
import {
    X, Plus, Trash2, GripVertical, CheckCircle2
} from 'lucide-react';
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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { FieldDefinition } from '@/scheme/extractionModel';

// Reuse the field schema for the sub-fields form
const subFieldFormSchema = z.object({
    sub_fields: z.array(z.object({
        key: z.string().min(1, 'Key required'),
        label: z.string().min(1, 'Label required'),
        description: z.string().optional(),
        rules: z.string().optional().nullable(),
        type: z.enum(['text', 'number', 'date', 'table']),
        is_required: z.boolean().default(false).optional(),
        dictionary_id: z.string().optional().nullable(),
        validation_regex: z.string().optional().nullable(),
    }))
});

type FormValues = z.infer<typeof subFieldFormSchema>;

interface SubFieldEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (subFields: FieldDefinition[]) => void;
    initialData?: FieldDefinition[] | null;
    dictionaryCategories?: { category: string }[];
}

function SortableItem({ id, children }: { id: string, children: React.ReactNode }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        position: 'relative' as const,
    };

    return (
        <div ref={setNodeRef} style={style} className={clsx(isDragging && 'opacity-60 shadow-lg rounded-lg')}>
            <div className="flex gap-2 items-center w-full">
                <div
                    className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground p-1"
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

export function SubFieldEditorModal({
    isOpen,
    onClose,
    onSave,
    initialData,
    dictionaryCategories
}: SubFieldEditorModalProps) {
    const form = useForm<FormValues>({
        resolver: zodResolver(subFieldFormSchema),
        defaultValues: {
            sub_fields: []
        }
    });

    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'sub_fields',
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

    useEffect(() => {
        if (isOpen) {
            form.reset({
                sub_fields: (initialData || []).map((f: any) => ({
                    key: f.key || '',
                    label: f.label || '',
                    description: f.description || '',
                    type: f.type || 'text',
                    rules: f.rules || '',
                    is_required: f.is_required || false,
                    dictionary_id: f.dictionary_id || '',
                    validation_regex: f.validation_regex || '',
                }))
            });
        }
    }, [isOpen, initialData, form]);

    if (!isOpen) return null;

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = fields.findIndex((f) => f.id === active.id);
            const newIndex = fields.findIndex((f) => f.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                move(oldIndex, newIndex);
            }
        }
    };

    const handleSave = () => {
        // Validation using hook-form
        form.handleSubmit((data) => {
            // Filter out fully empty rows if any (just extra safety)
            const cleanedFields = data.sub_fields.filter(f => f.key.trim() !== '');
            onSave(cleanedFields as any);
        })();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-background rounded-2xl shadow-xl w-[90vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
                    <div>
                        <h2 className="text-lg font-bold">서브 필드(열) 스키마 전용 설정</h2>
                        <p className="text-xs text-muted-foreground mt-1">테이블/배열 필드 내부에 포함될 구체적인 컬럼(열) 요소들을 정의합니다.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-muted/5 custom-scrollbar">
                    {fields.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center">
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                                <Plus className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h3 className="text-sm font-bold text-foreground mb-2">서브 필드가 아직 정의되지 않았습니다.</h3>
                            <p className="text-xs text-muted-foreground max-w-[400px]">
                                이대로 저장할 경우, LLM이 &apos;항목 설명(Description)&apos;에 기재된 내용을 바탕으로 스스로 컬럼 구조를 추론합니다.
                            </p>
                        </div>
                    ) : (
                        <div className="w-full border border-border rounded-xl bg-card overflow-hidden">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-muted/30 text-[10px] font-black tracking-tight text-muted-foreground uppercase">
                                <div className="col-span-3">KEY (컬럼명)</div>
                                <div className="col-span-3">DESCRIPTION (설명)</div>
                                <div className="col-span-3">PROPERTIES (유형, 사전, 정규식 등)</div>
                                <div className="col-span-2">RULES (규칙)</div>
                                <div className="col-span-1"></div>
                            </div>

                            {/* Table Body / Sortable List */}
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                                    <div className="flex flex-col divide-y divide-border pt-1 pb-1">
                                        {fields.map((field, index) => (
                                            <SortableItem key={field.id} id={field.id}>
                                                <div className="grid grid-cols-12 gap-4 px-4 py-3 items-start hover:bg-muted/10 transition-colors group">
                                                    {/* KEY */}
                                                    <div className="col-span-3">
                                                        <Input
                                                            {...form.register(`sub_fields.${index}.key`)}
                                                            placeholder="e.g. amount"
                                                            className="h-9 text-xs font-mono font-bold bg-transparent border-transparent hover:border-input focus:border-input shadow-none px-2"
                                                        />
                                                    </div>

                                                    {/* DESCRIPTION */}
                                                    <div className="col-span-3">
                                                        <Input
                                                            {...form.register(`sub_fields.${index}.label`)}
                                                            placeholder="항목 설명"
                                                            className="h-9 text-xs bg-transparent border-transparent hover:border-input focus:border-input shadow-none px-2"
                                                        />
                                                    </div>

                                                    {/* PROPERTIES */}
                                                    <div className="col-span-3 space-y-2 flex flex-col justify-center">
                                                        <div className="flex gap-2">
                                                            <Select
                                                                value={form.watch(`sub_fields.${index}.type`)}
                                                                onValueChange={(val: any) => form.setValue(`sub_fields.${index}.type`, val)}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs bg-background w-24">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="text">Text</SelectItem>
                                                                    <SelectItem value="number">Number</SelectItem>
                                                                    <SelectItem value="date">Date</SelectItem>
                                                                </SelectContent>
                                                            </Select>

                                                            <Select
                                                                value={form.watch(`sub_fields.${index}.dictionary_id`) || "none"}
                                                                onValueChange={(val) => form.setValue(`sub_fields.${index}.dictionary_id`, val === "none" ? null : val)}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs bg-background flex-1">
                                                                    <SelectValue placeholder="딕셔너리 매핑 안함" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="none">매핑 안함</SelectItem>
                                                                    {dictionaryCategories?.map(cat => (
                                                                        <SelectItem key={cat.category} value={cat.category}>{cat.category}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        <div className="flex items-center gap-3 px-1">
                                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                                <div
                                                                    className={clsx(
                                                                        "h-3.5 w-3.5 rounded-sm border transition-colors flex items-center justify-center",
                                                                        form.watch(`sub_fields.${index}.is_required`) ? "bg-primary border-primary" : "border-border bg-background"
                                                                    )}
                                                                    onClick={() => form.setValue(`sub_fields.${index}.is_required`, !form.watch(`sub_fields.${index}.is_required`))}
                                                                >
                                                                    {form.watch(`sub_fields.${index}.is_required`) && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                                                                </div>
                                                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">필수 항목</span>
                                                            </label>


                                                            <div className="relative flex-1">
                                                                <Input
                                                                    {...form.register(`sub_fields.${index}.validation_regex`)}
                                                                    placeholder="정규식 (e.g. ^[0-9]+$)"
                                                                    className="h-6 text-[10px] font-mono bg-transparent border-transparent hover:border-input focus:border-input shadow-none px-1 h-auto py-0.5"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* RULES */}
                                                    <div className="col-span-2">
                                                        <Input
                                                            {...form.register(`sub_fields.${index}.rules`)}
                                                            placeholder="커스텀 추출 룰"
                                                            className="h-9 text-xs bg-transparent border-transparent hover:border-input focus:border-input shadow-none px-2"
                                                        />
                                                    </div>

                                                    {/* ACTIONS */}
                                                    <div className="col-span-1 flex items-center justify-end h-full">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => remove(index)}
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </SortableItem>
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => append({ key: '', label: '', type: 'text', is_required: false })}
                        className="mt-4 w-full py-3 border-2 border-dashed border-border hover:border-primary/50 bg-background text-muted-foreground hover:text-foreground rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        컬럼(Column) 추가
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="text-yellow-500">💡</span> Key 값을 입력하지 않은 빈 로우(Row)는 저장 시 자동으로 삭제됩니다.
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            취소
                        </Button>
                        <Button size="sm" className="bg-blue-500 hover:bg-blue-600 font-bold" onClick={handleSave}>
                            저장 및 적용
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
