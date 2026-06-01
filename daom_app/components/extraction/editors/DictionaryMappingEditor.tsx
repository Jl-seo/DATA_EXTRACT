'use client';

import { useState } from 'react';
import {
    BookOpen,
    Download,
    Search,
    Plus,
    Trash2,
    Upload,
    AlertCircle,
    CheckCircle2,
    HelpCircle,
    Info,
    Loader2,
    ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
    getDictionaryCategories,
    uploadDictionaryData,
    searchDictionary,
    deleteDictionaryCategory
} from '@/actions/dictionary';
import { NormalizationDictionary, DictionaryCategorySummary } from '@/scheme/normalizationDictionary';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

export function DictionaryMappingEditor() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchCategory, setSearchCategory] = useState('all');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<NormalizationDictionary[]>([]);
    const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);

    // 카테고리 목록 조회
    const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
        queryKey: ['dictionary-categories'],
        queryFn: () => getDictionaryCategories(),
    });

    const deleteMutation = useMutation({
        mutationFn: (category: string) => deleteDictionaryCategory(category),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dictionary-categories'] });
            toast.success('딕셔너리가 삭제되었습니다.');
        },
        onError: () => {
            toast.error('삭제 중 오류가 발생했습니다.');
        }
    });

    const handleDownloadTemplate = () => {
        const headers = ["표준코드(Code)", "표시명(Name)", "동의어1(Alias1)", "동의어2(Alias2)"];
        const sampleRows = [
            ["KRPUS", "부산항", "Busan", "Pusan"],
            ["AEJEA", "제벨알리", "Jebel Ali", "JEA"],
            ["NLRTM", "로테르담", "Rotterdam", "RTM"]
        ];

        const csvContent = [
            headers.join(","),
            ...sampleRows.map(row => row.join(","))
        ].join("\n");

        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "dictionary_template.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, categoryName?: string) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let targetCategory = categoryName;
        if (!targetCategory) {
            const newName = prompt('새로운 딕셔너리 이름을 입력하세요:');
            if (!newName) return;
            targetCategory = newName.trim();
        }

        if (!targetCategory) return;

        setUploadingCategory(targetCategory);
        const formData = new FormData();
        formData.append('file', file);

        try {
            await uploadDictionaryData(targetCategory, formData);
            queryClient.invalidateQueries({ queryKey: ['dictionary-categories'] });
            toast.success('사전 데이터가 성공적으로 업로드되었습니다.');
        } catch (error) {
            toast.error('업로드 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'));
        } finally {
            setUploadingCategory(null);
            e.target.value = '';
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        try {
            const results = await searchDictionary(searchQuery, searchCategory);
            setSearchResults(results);
        } catch (error) {
            toast.error('검색 중 오류가 발생했습니다.');
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-6 mt-3 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-6 text-slate-800">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <h3 className="text-base font-bold">정규화 딕셔너리 연동</h3>
            </div>

            <div className="space-y-8">
                {/* 가이드 영역 */}
                <Card className="bg-white border-blue-100 shadow-sm relative overflow-hidden">
                    <div className="p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BookOpen className="w-4 h-4 text-blue-600" />
                                <h4 className="text-sm font-bold text-blue-900 leading-none">동의어 사전(Synonym Dictionary) 연동 가이드</h4>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="bg-white border-blue-200 text-blue-600 hover:bg-blue-50 text-xs font-semibold gap-2 h-8 px-3"
                                onClick={handleDownloadTemplate}
                            >
                                <Download className="w-3.5 h-3.5" />
                                템플릿 다운로드
                            </Button>
                        </div>
                        <p className="text-xs text-blue-700 font-medium">
                            추출된 다양한 유사 텍스트를 하나의 표준 코드로 통일(정규화)할 때 사용합니다.
                        </p>

                        <div className="bg-white/80 rounded-lg p-5 border border-blue-100/50 space-y-2.5">
                            <div className="flex items-center gap-2 text-xs font-bold text-amber-600 mb-1">
                                <AlertCircle className="w-4 h-4" />
                                엑셀/CSV 데이터 작성 규칙 (열 순서가 매우 중요합니다!)
                            </div>
                            <div className="space-y-1.5 pl-6 text-xs text-slate-700">
                                <p><Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-700 border-none h-4 px-1 mr-2">1</Badge> <span className="font-bold text-blue-900 whitespace-nowrap">1열 (필수):</span> 정규화된 <span className="font-bold text-blue-900">표준 코드</span> (예: KRPUS)</p>
                                <p><Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-700 border-none h-4 px-1 mr-2">2</Badge> <span className="font-bold text-blue-900 whitespace-nowrap">2열 (필수):</span> <span className="font-bold text-blue-900">표기 명칭</span> (예: 부산항)</p>
                                <p><Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-700 border-none h-4 px-1 mr-2">3</Badge> <span className="font-bold text-blue-900 whitespace-nowrap">3열 이후 (선택):</span> <span className="font-bold text-blue-900">각종 유사어 나열</span> (예: Busan, Pusan)</p>
                            </div>
                        </div>

                        <p className="text-[10px] text-blue-400 font-medium px-0.5">
                            * 유효한 조합인지 검사하는 <span className="font-bold underline underline-offset-2">마스터 데이터</span>(예: 특정 선사 & 특정 포트 필터링)는 우측 &lsquo;참조 데이터&rsquo; 탭을 이용해주세요.
                        </p>
                    </div>
                </Card>

                {/* 등록된 딕셔너리 목록 */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-slate-700" />
                            <h4 className="text-sm font-bold text-slate-800">등록된 딕셔너리</h4>
                        </div>
                        <div className="relative">
                            <Input
                                id="new-dict-upload"
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                className="hidden"
                                onChange={(e) => handleFileUpload(e)}
                            />
                            <Label 
                                htmlFor="new-dict-upload"
                                className="inline-flex items-center justify-center rounded-lg text-xs font-bold transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 text-slate-500 hover:text-slate-800 hover:bg-slate-100 h-8 px-3 cursor-pointer gap-1.5"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                딕셔너리 추가
                            </Label>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {isLoadingCategories ? (
                            <div className="py-12 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 bg-white text-slate-400">
                                <Loader2 className="w-8 h-8 animate-spin opacity-50" />
                                <p className="text-sm">딕셔너리 목록을 불러오는 중입니다.</p>
                            </div>
                        ) : categories.length > 0 ? (
                            categories.map((cat) => (
                                <div 
                                    key={cat.category}
                                    className="flex items-center justify-between px-5 py-3.5 bg-white border border-slate-200/80 hover:border-blue-200 shadow-sm rounded-xl transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <BookOpen className="w-4 h-4 text-blue-500/70" />
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="text-sm font-bold text-foreground">{cat.category}</span>
                                            <span className="text-[11px] text-muted-foreground font-medium">({cat.count}건)</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                                        <div className="relative">
                                            <Input
                                                id={`upload-${cat.category}`}
                                                type="file"
                                                accept=".csv,.xlsx,.xls"
                                                className="hidden"
                                                onChange={(e) => handleFileUpload(e, cat.category)}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/5"
                                                asChild
                                            >
                                                <Label htmlFor={`upload-${cat.category}`}>
                                                    {uploadingCategory === cat.category ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                                </Label>
                                            </Button>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                                            onClick={() => {
                                                if (confirm(`'${cat.category}' 카테고리의 모든 데이터를 삭제하시겠습니까?`)) {
                                                    deleteMutation.mutate(cat.category);
                                                }
                                            }}
                                            disabled={deleteMutation.isPending}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-12 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 bg-white text-slate-400">
                                <Info className="w-8 h-8 opacity-50" />
                                <p className="text-sm">등록된 딕셔너리가 없습니다.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 검색 테스트 영역 */}
                <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-slate-700" />
                        <h4 className="text-sm font-bold text-slate-800">검색 테스트</h4>
                    </div>

                    <div className="flex gap-2">
                        <Select value={searchCategory} onValueChange={setSearchCategory}>
                            <SelectTrigger className="w-[140px] h-11 bg-background border-muted-foreground/20 rounded-xl">
                                <SelectValue placeholder="카테고리" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="all">전체</SelectItem>
                                {categories.map(c => (
                                    <SelectItem key={c.category} value={c.category}>{c.category}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="relative flex-1">
                            <Input
                                placeholder="검색어 입력 (예: Jebel Ali)"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                className="h-11 pl-4 pr-12 bg-background border-muted-foreground/20 rounded-xl focus:ring-primary/20 text-sm"
                            />
                        </div>

                        <Button
                            className="h-11 px-8 gap-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-md font-bold text-sm transition-all"
                            onClick={handleSearch}
                            disabled={isSearching}
                        >
                            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            검색
                        </Button>
                    </div>

                    {/* 검색 결과 표시 */}
                    {searchResults.length > 0 && (
                        <div className="mt-4 border rounded-xl overflow-hidden bg-background shadow-sm animate-in slide-in-from-top-2 duration-300">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-muted/50 border-b">
                                        <th className="px-4 py-3 text-left font-bold text-muted-foreground uppercase tracking-wider">코드</th>
                                        <th className="px-4 py-3 text-left font-bold text-muted-foreground uppercase tracking-wider">표준 명칭</th>
                                        <th className="px-4 py-3 text-left font-bold text-muted-foreground uppercase tracking-wider">카테고리</th>
                                        <th className="px-4 py-3 text-left font-bold text-muted-foreground uppercase tracking-wider">별칭</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.slice(0, 100).map((item, i) => (
                                        <tr key={i} className="border-b last:border-0 hover:bg-muted/5 transition-colors">
                                            <td className="px-4 py-3.5 font-black text-blue-600 uppercase tracking-tight">{item.code}</td>
                                            <td className="px-4 py-3.5 font-bold text-foreground">{item.name}</td>
                                            <td className="px-4 py-3.5">
                                                <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600 border-none font-bold h-5 px-2 capitalize">{item.category}</Badge>
                                            </td>
                                            <td className="px-4 py-3.5 text-muted-foreground font-medium truncate max-w-[200px]">
                                                {item.aliases.join(', ') || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {searchResults.length > 100 && (
                                <div className="p-3 text-center bg-muted/10 text-[10px] font-bold text-muted-foreground/60 border-t">
                                    외 {searchResults.length - 100}건의 결과가 더 있습니다.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
