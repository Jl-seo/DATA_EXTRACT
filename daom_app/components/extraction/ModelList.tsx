'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useExtractionModels, useDeleteExtractionModel } from '@/queries/extraction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Plus, Search, Loader2, Edit, Trash2, FileText, Split, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ModelList() {
    const router = useRouter();
    const { data: models, isLoading } = useExtractionModels();
    const deleteModel = useDeleteExtractionModel();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredModels = models?.filter(model =>
        model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        model.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleDelete = async (id: string) => {
        if (!confirm('정말로 이 모델을 삭제하시겠습니까?')) return;
        try {
            await deleteModel.mutateAsync(id);
            toast.success('모델이 삭제되었습니다.');
        } catch (error) {
            toast.error('삭제 실패');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div className="relative w-72">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="모델 검색..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
                <Button asChild>
                    <Link href="/admin/extraction-models/new">
                        <Plus className="mr-2 h-4 w-4" /> 모델 생성
                    </Link>
                </Button>
            </div>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>이름</TableHead>
                            <TableHead>유형</TableHead>
                            <TableHead>필드 수</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="w-[100px] text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <div className="flex justify-center"><Loader2 className="animate-spin" /></div>
                                </TableCell>
                            </TableRow>
                        ) : filteredModels?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    모델이 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredModels?.map((model) => (
                                <TableRow key={model.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <span>{model.name}</span>
                                            <span className="text-xs text-muted-foreground">{model.description}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {model.is_super_model ? (
                                                <Layers className="w-3.5 h-3.5 text-purple-500" />
                                            ) : model.model_type === 'comparison' ? (
                                                <Split className="w-3.5 h-3.5 text-rose-500" />
                                            ) : (
                                                <FileText className="w-3.5 h-3.5 text-blue-500" />
                                            )}
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    "capitalize font-bold text-[10px] px-2 py-0",
                                                    model.is_super_model
                                                        ? "border-purple-200 bg-purple-50 text-purple-700"
                                                        : model.model_type === 'comparison'
                                                            ? "border-rose-200 bg-rose-50 text-rose-700"
                                                            : "border-blue-200 bg-blue-50 text-blue-700"
                                                )}
                                            >
                                                {model.is_super_model ? '상위 모델' : model.model_type === 'comparison' ? '비교 분석' : '일반 추출'}
                                            </Badge>
                                        </div>
                                        {model.azure_model_id && (
                                            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                                                ID: {model.azure_model_id}
                                            </p>
                                        )}
                                    </TableCell>
                                    <TableCell>{model.fields.length}</TableCell>
                                    <TableCell>
                                        <Badge variant={model.is_active ? 'default' : 'secondary'}>
                                            {model.is_active ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => router.push(`/admin/extraction-models/${model.id}`)}>
                                                    <Edit className="mr-2 h-4 w-4" /> 수정
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => router.push(`/extraction/run/${model.id}`)}>
                                                    <FileText className="mr-2 h-4 w-4" /> 테스트 실행
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => handleDelete(model.id)} className="text-red-600">
                                                    <Trash2 className="mr-2 h-4 w-4" /> 삭제
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
