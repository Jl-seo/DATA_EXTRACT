'use client';

import { useState } from 'react';
import { useMenus, useCreateMenu, useUpdateMenu, useDeleteMenu } from '@/queries/menu';
import { Menu } from '@/scheme/menu';
import { toast } from 'sonner';
import { Loader2, Plus, Menu as MenuIcon, Pencil, Trash2, MoveUp, MoveDown } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

export default function MenusPage() {
    const { data: menus, isLoading } = useMenus();
    const createMenu = useCreateMenu();
    const updateMenuMutation = useUpdateMenu();
    const deleteMenuMutation = useDeleteMenu();

    const [isCreating, setIsCreating] = useState(false);
    const [newMenuId, setNewMenuId] = useState('');
    const [newMenuName, setNewMenuName] = useState('');
    const [newMenuIcon, setNewMenuIcon] = useState('');
    const [newMenuOrder, setNewMenuOrder] = useState(10);

    const handleCreateMenu = async () => {
        if (!newMenuId.trim() || !newMenuName.trim()) {
            toast.error('메뉴 ID와 이름을 입력해주세요');
            return;
        }

        try {
            await createMenu.mutateAsync({
                id: newMenuId,
                name: newMenuName,
                icon: newMenuIcon || 'Circle',
                order: newMenuOrder,
                parent: null,
            });
            toast.success('메뉴가 생성되었습니다');
            setNewMenuId('');
            setNewMenuName('');
            setNewMenuIcon('');
            setNewMenuOrder(10);
            setIsCreating(false);
        } catch (error) {
            toast.error('메뉴 생성에 실패했습니다');
        }
    };

    const handleDeleteMenu = async (menuId: string, menuName: string) => {
        if (!confirm(`"${menuName}" 메뉴를 삭제하시겠습니까?`)) {
            return;
        }

        try {
            await deleteMenuMutation.mutateAsync({ menuId });
            toast.success('메뉴가 삭제되었습니다');
        } catch (error) {
            toast.error('메뉴 삭제에 실패했습니다');
        }
    };

    // 계층 구조로 메뉴 정리
    const getMenuHierarchy = (menuList: Menu[]) => {
        const topLevel = menuList.filter((m) => !m.parent);
        const childMenus = menuList.filter((m) => m.parent);

        return topLevel.map((parent) => ({
            ...parent,
            children: childMenus.filter((c) => c.parent === parent.id).sort((a, b) => a.order - b.order),
        }));
    };

    const menuHierarchy = menus ? getMenuHierarchy(menus) : [];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">메뉴 관리</h1>
                    <p className="text-muted-foreground">애플리케이션 메뉴를 관리합니다</p>
                </div>
                <Dialog open={isCreating} onOpenChange={setIsCreating}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            새 메뉴 만들기
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>새 메뉴 만들기</DialogTitle>
                            <DialogDescription>새로운 메뉴 항목을 생성합니다</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="id">메뉴 ID</Label>
                                <Input
                                    id="id"
                                    placeholder="예: my-menu"
                                    value={newMenuId}
                                    onChange={(e) => setNewMenuId(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="name">메뉴 이름</Label>
                                <Input
                                    id="name"
                                    placeholder="예: 내 메뉴"
                                    value={newMenuName}
                                    onChange={(e) => setNewMenuName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="icon">아이콘 (Lucide)</Label>
                                <Input
                                    id="icon"
                                    placeholder="예: Circle"
                                    value={newMenuIcon}
                                    onChange={(e) => setNewMenuIcon(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="order">정렬 순서</Label>
                                <Input
                                    id="order"
                                    type="number"
                                    value={newMenuOrder}
                                    onChange={(e) => setNewMenuOrder(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreating(false)}>
                                취소
                            </Button>
                            <Button onClick={handleCreateMenu} disabled={createMenu.isPending}>
                                {createMenu.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                생성하기
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>메뉴 목록</CardTitle>
                    <CardDescription>등록된 메뉴와 하위 메뉴를 확인할 수 있습니다</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin" />
                        </div>
                    ) : (
                        <div className="border rounded-lg">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>메뉴 이름</TableHead>
                                        <TableHead>ID</TableHead>
                                        <TableHead>아이콘</TableHead>
                                        <TableHead>순서</TableHead>
                                        <TableHead>하위 메뉴 수</TableHead>
                                        <TableHead className="text-right">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {menuHierarchy.length > 0 ? (
                                        <>
                                            {menuHierarchy.map((menu) => (
                                                <>
                                                    <TableRow key={menu.id}>
                                                        <TableCell className="font-medium">
                                                            <div className="flex items-center gap-2">
                                                                <MenuIcon className="w-4 h-4 text-muted-foreground" />
                                                                {menu.name}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">{menu.id}</TableCell>
                                                        <TableCell>{menu.icon}</TableCell>
                                                        <TableCell>{menu.order}</TableCell>
                                                        <TableCell>{menu.children?.length || 0}</TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleDeleteMenu(menu.id, menu.name)}
                                                                disabled={deleteMenuMutation.isPending}
                                                            >
                                                                <Trash2 className="w-4 h-4 text-red-500" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                    {menu.children &&
                                                        menu.children.map((child) => (
                                                            <TableRow key={child.id} className="bg-muted/20">
                                                                <TableCell className="pl-12 text-sm">{child.name}</TableCell>
                                                                <TableCell className="text-sm text-muted-foreground">{child.id}</TableCell>
                                                                <TableCell className="text-sm">{child.icon}</TableCell>
                                                                <TableCell className="text-sm">{child.order}</TableCell>
                                                                <TableCell>-</TableCell>
                                                                <TableCell className="text-right">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => handleDeleteMenu(child.id, child.name)}
                                                                        disabled={deleteMenuMutation.isPending}
                                                                    >
                                                                        <Trash2 className="w-4 h-4 text-red-500" />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                </>
                                            ))}
                                        </>
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                메뉴가 없습니다
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
