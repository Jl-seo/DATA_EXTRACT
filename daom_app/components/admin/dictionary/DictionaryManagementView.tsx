'use client';

import { useState, useTransition, useMemo } from 'react';
import { 
    BookOpen, 
    Upload, 
    Search, 
    Database, 
    BrainCircuit, 
    Settings2, 
    FileUp, 
    ChevronRight,
    Loader2,
    ArrowLeft,
    Edit3,
    Trash2,
    Download,
    Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
    uploadDictionaryData, 
    getDictionaryCategories, 
    updateDictionaryItem,
    searchDictionary,
    getDictionaryItems,
    deleteDictionaryItem
} from '@/actions/dictionary';
import { DictionaryCategorySummary, NormalizationDictionary } from '@/scheme/normalizationDictionary';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

export default function DictionaryManagementView() {
    const queryClient = useQueryClient();
    const [isUploading, startUploadTransition] = useTransition();
    const [uploadCategory, setUploadCategory] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchCategory, setSearchCategory] = useState('all');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<NormalizationDictionary[]>([]);


    // 상세 보기 상태
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [detailSearch, setDetailSearch] = useState('');

    // 인라인 수정 상태
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{
        code: string;
        name: string;
        aliases: string;
    }>({ code: '', name: '', aliases: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // 카테고리 목록 조회
    const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
        queryKey: ['dictionary-categories'],
        queryFn: () => getDictionaryCategories(),
    });

    // 상세 아이템 조회
    const { data: detailData, isLoading: isLoadingDetails } = useQuery({
        queryKey: ['dictionary-items', selectedCategory],
        queryFn: () => selectedCategory ? getDictionaryItems(selectedCategory) : null,
        enabled: !!selectedCategory,
    });

    // 상세 보기 내 필터링
    const filteredItems = useMemo(() => {
        if (!detailData?.items) return [];
        if (!detailSearch.trim()) return detailData.items;
        
        const term = detailSearch.toLowerCase();
        return detailData.items.filter(item => 
            item.code.toLowerCase().includes(term) || 
            item.name.toLowerCase().includes(term) ||
            item.aliases.some(a => a.toLowerCase().includes(term))
        );
    }, [detailData, detailSearch]);

    // 업로드 처리
    const handleUpload = async () => {
        if (!uploadCategory) {
            toast.error('카테고리 명칭을 입력해주세요.');
            return;
        }
        if (!selectedFile) {
            toast.error('업로드할 파일을 선택해주세요.');
            return;
        }

        const formData = new FormData();
        formData.append('file', selectedFile);

        startUploadTransition(async () => {
            try {
                const result = await uploadDictionaryData(uploadCategory, formData);
                toast.success(`업로드 완료: 성공 ${result.success}건, 실패 ${result.failure}건`);
                setSelectedFile(null);
                setUploadCategory('');
                queryClient.invalidateQueries({ queryKey: ['dictionary-categories'] });
                if (selectedCategory === uploadCategory) {
                    queryClient.invalidateQueries({ queryKey: ['dictionary-items', selectedCategory] });
                }
            } catch (error: any) {
                toast.error(`업로드 실패: ${error.message}`);
            }
        });
    };

    // 인라인 수정 핸들러
    const handleEditStart = (item: NormalizationDictionary) => {
        setEditingId(item.id!);
        setEditForm({
            code: item.code,
            name: item.name,
            aliases: item.aliases.join(', ')
        });
    };

    const handleEditCancel = () => {
        setEditingId(null);
    };

    const handleEditSave = async () => {
        if (!editingId || !selectedCategory) return;

        setIsSaving(true);
        try {
            await updateDictionaryItem(editingId, selectedCategory, {
                code: editForm.code,
                name: editForm.name,
                aliases: editForm.aliases.split(',').map(a => a.trim()).filter(Boolean)
            });
            toast.success('수정되었습니다.');
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: ['dictionary-items', selectedCategory] });
        } catch (error) {
            toast.error('수정 중 오류가 발생했습니다.');
        } finally {
            setIsSaving(false);
        }
    };

    // 삭제 핸들러
    const handleDeleteItem = async (id: string) => {
        if (!selectedCategory || !confirm('정말 삭제하시겠습니까?')) return;

        setDeletingId(id);
        try {
            await deleteDictionaryItem(id, selectedCategory);
            toast.success('삭제되었습니다.');
            queryClient.invalidateQueries({ queryKey: ['dictionary-items', selectedCategory] });
        } catch (error) {
            toast.error('삭제 중 오류가 발생했습니다.');
        } finally {
            setDeletingId(null);
        }
    };

    // 검색 테스트 처리
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


    const handleDownloadTemplate = () => {
        const headers = ["표준코드(Code)", "표시명(Name)", "동의어1(Alias1)", "동의어2(Alias2)"];
        const sampleRows = [
            ["KRPUS", "부산항", "Busan", "Pusan"],
            ["AEJEA", "제벨알리", "Jebel Ali", "JEA"],
            ["NLRTM", "로테르담", "Rotterdam", "RTM"],
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

    return (
        <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <BookOpen className="w-6 h-6 text-primary" />
                    <h1 className="text-2xl font-bold tracking-tight">통합 사전 관리</h1>
                </div>
                <p className="text-muted-foreground">
                    추출 파이프라인에서 사용하는 모든 사전 데이터를 한 곳에서 관리합니다.
                </p>
            </div>

            {/* Main Tabs */}
            <Tabs defaultValue="global" className="w-full">
                <TabsList className="bg-muted/50 p-1 rounded-xl mb-4">
                    <TabsTrigger value="global" className="rounded-lg gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        <Globe className="w-3.5 h-3.5" />
                        글로벌 사전
                        <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">
                            {categories.length}
                        </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="rounded-lg gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        <BrainCircuit className="w-3.5 h-3.5" />
                        AI 학습 사전
                        <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">0</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="rounded-lg gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        <Settings2 className="w-3.5 h-3.5" />
                        모델별 수동 사전
                        <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-4 text-[10px]">0</Badge>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="global" className="space-y-4 outline-none">
                    {/* Notice Banner */}
                    <div className="bg-blue-50/40 border border-blue-100/50 p-4 rounded-xl flex gap-3 items-start">
                        <p className="text-[13px] text-blue-600 font-medium">
                            전체 모델이 공유하는 참조 데이터 (Port, Carrier, Route)
                        </p>
                    </div>

                    {/* Upload Section */}
                    <Card className="border border-muted-foreground/10 shadow-sm bg-background/50 backdrop-blur-sm">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
                                <FileUp className="w-4 h-4 text-primary" />
                                Excel/CSV 업로드
                            </CardTitle>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 px-3 gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
                                onClick={handleDownloadTemplate}
                            >
                                <Download className="w-3.5 h-3.5" />
                                양식 다운로드
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                                <div className="md:col-span-12 lg:col-span-5 space-y-2.5">
                                    <Label className="text-xs font-bold text-muted-foreground">카테고리명</Label>
                                    <Input 
                                        placeholder="예: port, carrier, route" 
                                        value={uploadCategory}
                                        onChange={(e) => setUploadCategory(e.target.value)}
                                        className="h-12 shadow-xs border-muted-foreground/15 rounded-lg bg-background/50 focus:bg-background transition-all"
                                    />
                                </div>
                                <div className="md:col-span-12 lg:col-span-5 space-y-2.5">
                                    <Label className="text-xs font-bold text-muted-foreground">파일 선택</Label>
                                    <div className="flex items-center gap-4 bg-background/30 p-1.5 pr-4 border border-muted-foreground/15 rounded-lg h-12">
                                        <Button 
                                            variant="secondary" 
                                            size="sm" 
                                            className="h-9 px-4 gap-2 bg-blue-600 text-white hover:bg-blue-700 shadow-sm rounded-md font-bold text-[11px]"
                                            onClick={() => document.getElementById('file-upload')?.click()}
                                        >
                                            파일 선택
                                        </Button>
                                        <span className="text-[11px] text-muted-foreground font-medium truncate">
                                            {selectedFile ? selectedFile.name : '선택된 파일 없음'}
                                        </span>
                                        <input 
                                            id="file-upload"
                                            type="file" 
                                            accept=".xlsx,.xls,.csv"
                                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                            className="hidden"
                                        />
                                    </div>
                                </div>
                                <div className="md:col-span-12 lg:col-span-2 text-right">
                                    <Button 
                                        className="h-12 w-full lg:w-auto px-8 gap-2 shadow-lg shadow-blue-600/20 rounded-lg text-sm font-black bg-blue-600 hover:bg-blue-700" 
                                        onClick={handleUpload}
                                        disabled={isUploading || !selectedFile}
                                    >
                                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                        업로드
                                    </Button>
                                </div>
                            </div>
                            <p className="mt-3 text-[11px] text-muted-foreground/50">
                                1열=코드, 2열=이름, 3열=별칭(alias). 기존 카테고리에 같은 이름으로 올리면 덮어씁니다.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Content Area (Categories Grid OR Detail Table) */}
                    <div className="relative overflow-hidden">
                        {!selectedCategory ? (
                            /* Registered Categories Section */
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold flex items-center gap-2 px-1">
                                        <Database className="w-4 h-4 text-primary" />
                                        등록된 카테고리
                                    </h3>
                                    <span className="text-[11px] text-muted-foreground font-medium">
                                        총 {categories.length}개 항목
                                    </span>
                                </div>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {isLoadingCategories ? (
                                        Array.from({ length: 3 }).map((_, i) => (
                                            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
                                        ))
                                    ) : categories.length > 0 ? (
                                        categories.map((cat: DictionaryCategorySummary) => (
                                            <Card 
                                                key={cat.category} 
                                                className="border border-muted-foreground/5 bg-background/40 hover:bg-background hover:border-primary/20 transition-all cursor-pointer group shadow-xs"
                                                onClick={() => setSelectedCategory(cat.category)}
                                            >
                                                <CardContent className="p-4 flex items-center justify-between">
                                                    <div className="space-y-1">
                                                        <p className="font-bold text-sm tracking-tight text-foreground uppercase">
                                                            {cat.category}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                            {cat.category === 'CARRIER' ? '선사 코드 (SCAC 기반)' : 
                                                             cat.category === 'PORT' ? '항구 코드 (UN/LOCODE 기반)' : 
                                                             '통합 참조 데이터'}
                                                        </p>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1">
                                                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/10 text-[10px] font-bold">
                                                            {cat.count.toLocaleString()}건
                                                        </Badge>
                                                        <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))
                                    ) : (
                                        <div className="col-span-full py-20 text-center border-2 border-dashed border-muted rounded-2xl bg-muted/20">
                                            <p className="text-sm text-muted-foreground">등록된 사전 데이터가 없습니다. 파일을 업로드해 주세요.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* Detail Table Section */
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500 pb-12">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-6">
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            onClick={() => setSelectedCategory(null)}
                                            className="h-8 w-8 rounded-full hover:bg-muted"
                                        >
                                            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                                        </Button>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="px-4 h-8 text-blue-600 font-extrabold uppercase tracking-tight bg-blue-50 border-blue-100/50 rounded-md">
                                                {selectedCategory}
                                            </Badge>
                                            <span className="text-sm font-bold text-foreground flex items-center gap-2">
                                                항목 목록 
                                                <span className="text-muted-foreground font-normal">
                                                    ({categories.find(c => c.category === selectedCategory)?.count.toLocaleString() ?? '0'}개)
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="relative w-64 md:w-80">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input 
                                            placeholder="코드 또는 이름 검색..." 
                                            className="pl-10 h-11 border-muted-foreground/15 focus:border-blue-500 bg-background shadow-xs rounded-full text-[13px] font-medium placeholder:text-muted-foreground/50"
                                            value={detailSearch}
                                            onChange={(e) => setDetailSearch(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <Card className="border border-muted-foreground/5 shadow-sm overflow-hidden bg-background">
                                    <CardContent className="p-0">
                                        <div className="relative w-full overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="bg-muted/10 border-b border-muted-foreground/5">
                                                        <th className="px-6 py-4 text-left font-semibold text-muted-foreground/80 w-[120px]">코드</th>
                                                        <th className="px-6 py-4 text-left font-semibold text-muted-foreground/80 w-[220px]">이름</th>
                                                        <th className="px-6 py-4 text-left font-semibold text-muted-foreground/80 min-w-[300px]">별칭 (Aliases)</th>
                                                        <th className="px-6 py-4 text-center font-semibold text-muted-foreground/80 w-[100px]">히트</th>
                                                        <th className="px-6 py-4 text-center font-semibold text-muted-foreground/80 w-[120px]">작업</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {isLoadingDetails ? (
                                                        Array.from({ length: 8 }).map((_, i) => (
                                                            <tr key={i} className="border-b border-muted-foreground/5">
                                                                <td colSpan={5} className="px-6 py-5">
                                                                    <div className="h-4 w-full bg-muted/40 animate-pulse rounded" />
                                                                </td>
                                                            </tr>
                                                        ))
                                                    ) : filteredItems.length > 0 ? (
                                                         filteredItems.map((item: NormalizationDictionary, i: number) => (
                                                             <tr key={item.id || i} className={cn(
                                                                "border-b border-muted-foreground/5 last:border-0 transition-colors",
                                                                editingId === item.id ? "bg-blue-50/30" : "hover:bg-muted/10"
                                                             )}>
                                                                {editingId === item.id ? (
                                                                    <>
                                                                        <td className="px-6 py-3">
                                                                            <Input 
                                                                                value={editForm.code}
                                                                                onChange={e => setEditForm(prev => ({ ...prev, code: e.target.value }))}
                                                                                className="h-9 text-sm font-bold bg-white border-muted-foreground/20 shadow-sm"
                                                                            />
                                                                        </td>
                                                                        <td className="px-6 py-3">
                                                                            <Input 
                                                                                value={editForm.name}
                                                                                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                                                className="h-9 text-sm font-medium bg-white border-muted-foreground/20 shadow-sm"
                                                                            />
                                                                        </td>
                                                                        <td className="px-6 py-3">
                                                                            <Input 
                                                                                value={editForm.aliases}
                                                                                onChange={e => setEditForm(prev => ({ ...prev, aliases: e.target.value }))}
                                                                                className="h-9 text-sm bg-white border-muted-foreground/20 shadow-sm"
                                                                                placeholder="쉼표로 구분..."
                                                                            />
                                                                        </td>
                                                                        <td className="px-6 py-3 text-center text-muted-foreground font-medium">0</td>
                                                                        <td className="px-6 py-3 text-center">
                                                                            <div className="flex items-center justify-center gap-3">
                                                                                <Button 
                                                                                    size="sm" 
                                                                                    onClick={handleEditSave}
                                                                                    disabled={isSaving}
                                                                                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold h-8 px-3 gap-1 shadow-sm"
                                                                                >
                                                                                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                                                                    저장
                                                                                </Button>
                                                                                <button 
                                                                                    onClick={handleEditCancel}
                                                                                    className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                                                                                >
                                                                                    취소
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <td className="px-6 py-4 font-bold text-primary uppercase text-sm tracking-tight">{item.code}</td>
                                                                        <td className="px-6 py-4 font-medium text-foreground text-sm">{item.name}</td>
                                                                        <td className="px-6 py-4">
                                                                            <div className="flex flex-wrap gap-1.5">
                                                                                {item.aliases.map((alias: string, ai: number) => (
                                                                                    <Badge key={ai} variant="secondary" className="bg-muted/50 text-muted-foreground hover:bg-muted font-normal h-5 py-0 px-2 text-[10px]">
                                                                                        {alias}
                                                                                    </Badge>
                                                                                ))}
                                                                                {item.aliases.length === 0 && <span className="text-muted-foreground/30">-</span>}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-6 py-4 text-center text-muted-foreground font-medium">0</td>
                                                                        <td className="px-6 py-4 text-center">
                                                                            <div className="flex items-center justify-center gap-1">
                                                                                <Button 
                                                                                    variant="ghost" 
                                                                                    size="icon" 
                                                                                    className="h-8 w-8 text-muted-foreground/60 hover:text-primary hover:bg-primary/5"
                                                                                    onClick={() => handleEditStart(item)}
                                                                                >
                                                                                    <Edit3 className="w-4 h-4" />
                                                                                </Button>
                                                                                <Button 
                                                                                    variant="ghost" 
                                                                                    size="icon" 
                                                                                    className="h-8 w-8 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5"
                                                                                    onClick={() => handleDeleteItem(item.id!)}
                                                                                    disabled={deletingId === item.id}
                                                                                >
                                                                                    {deletingId === item.id ? <Loader2 className="w-4 h-4 animate-spin text-destructive" /> : <Trash2 className="w-4 h-4" />}
                                                                                </Button>
                                                                            </div>
                                                                        </td>
                                                                    </>
                                                                )}
                                                             </tr>
                                                         ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan={5} className="px-6 py-40 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
                                                                <Search className="w-12 h-12 opacity-5" />
                                                                <p className="text-sm font-medium opacity-60">검색 결과가 없습니다.</p>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </div>

                    {/* Search Test Section (Only show when NO category is selected to match user image focus) */}
                    {!selectedCategory && (
                        <Card className="border-none shadow-sm bg-muted/30">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <Search className="w-4 h-4 text-primary" />
                                    검색 테스트
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Input 
                                            placeholder="예: busan, MAERSK" 
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                            className="h-10 pl-4 bg-background border-none shadow-sm"
                                        />
                                    </div>
                                    <Select value={searchCategory} onValueChange={setSearchCategory}>
                                        <SelectTrigger className="w-[140px] h-10 bg-background border-none shadow-sm">
                                            <SelectValue placeholder="카테고리" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">전체</SelectItem>
                                            {categories.map(c => (
                                                <SelectItem key={c.category} value={c.category}>{c.category}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button 
                                        variant="secondary" 
                                        className="h-10 px-6 gap-2 bg-background hover:bg-background/80 shadow-sm"
                                        onClick={handleSearch}
                                        disabled={isSearching}
                                    >
                                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        검색
                                    </Button>
                                </div>

                                {/* Search Results Preview */}
                                {searchResults.length > 0 && (
                                    <div className="mt-4 border rounded-xl overflow-hidden bg-background">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-muted/50 border-b">
                                                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">코드</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">표준 명칭</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">카테고리</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">별칭</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {searchResults.slice(0, 100).map((item, i) => (
                                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                                        <td className="px-4 py-3 font-medium text-primary uppercase">{item.code}</td>
                                                        <td className="px-4 py-3 font-semibold">{item.name}</td>
                                                        <td className="px-4 py-3">
                                                            <Badge variant="secondary" className="text-[9px] h-4">{item.category}</Badge>
                                                        </td>
                                                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                                                            {item.aliases.join(', ') || '-'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {searchResults.length > 100 && (
                                            <div className="p-2 text-center bg-muted/20 text-[10px] text-muted-foreground">
                                                외 {searchResults.length - 100}건의 결과가 더 있습니다.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="ai">
                    <div className="py-20 text-center border-2 border-dashed border-muted rounded-2xl bg-muted/10">
                        <BrainCircuit className="w-10 h-10 text-muted mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-muted-foreground">준비 중인 기능입니다</h3>
                        <p className="text-sm text-muted-foreground/60">LLM의 정규화 학습을 위한 데이터셋 관리 기능이 곧 추가될 예정입니다.</p>
                    </div>
                </TabsContent>

                <TabsContent value="manual">
                    <div className="py-20 text-center border-2 border-dashed border-muted rounded-2xl bg-muted/10">
                        <Settings2 className="w-10 h-10 text-muted mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-muted-foreground">준비 중인 기능입니다</h3>
                        <p className="text-sm text-muted-foreground/60">모델별로 별개의 사전 데이터를 수동으로 적용하는 기능이 추가될 예정입니다.</p>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// Helper icons
function Globe(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" x2="22" y1="12" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    )
}
