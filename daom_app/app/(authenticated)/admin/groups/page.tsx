'use client';

import { useState } from 'react';
import {
    useGroups,
    useCreateGroup,
    useUpdateGroup,
    useAddMemberToGroup,
    useRemoveMemberFromGroup,
    useSetGroupPermissions,
    useDeleteGroup,
} from '@/queries/group';
import { CreateGroupRequest, GroupMember } from '@/scheme/group';
import { toast } from 'sonner';
import {
    Loader2,
    Plus,
    Users,
    Shield,
    Trash2,
    Settings,
    UserPlus,
} from 'lucide-react';

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

export default function GroupsPage() {
    const { data: groups, isLoading } = useGroups();
    const createGroup = useCreateGroup();
    const deleteGroupMutation = useDeleteGroup();

    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) {
            toast.error('그룹 이름을 입력해주세요');
            return;
        }

        try {
            await createGroup.mutateAsync({
                name: newGroupName,
                description: newGroupDesc,
                superAdmin: false,
            });
            toast.success('그룹이 생성되었습니다');
            setNewGroupName('');
            setNewGroupDesc('');
            setIsCreating(false);
        } catch (error) {
            toast.error('그룹 생성에 실패했습니다');
        }
    };

    const handleDeleteGroup = async (groupId: string, groupName: string) => {
        if (!confirm(`"${groupName}" 그룹을 삭제하시겠습니까?`)) {
            return;
        }

        try {
            await deleteGroupMutation.mutateAsync({ groupId });
            toast.success('그룹이 삭제되었습니다');
        } catch (error) {
            toast.error('그룹 삭제에 실패했습니다');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">그룹 관리</h1>
                    <p className="text-muted-foreground">사용자 그룹과 권한을 관리합니다</p>
                </div>
                <Dialog open={isCreating} onOpenChange={setIsCreating}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            새 그룹 만들기
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>새 그룹 만들기</DialogTitle>
                            <DialogDescription>
                                새로운 사용자 그룹을 생성합니다
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">그룹 이름</Label>
                                <Input
                                    id="name"
                                    placeholder="예: 마케팅팀"
                                    value={newGroupName}
                                    onChange={(e) => setNewGroupName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">설명 (선택)</Label>
                                <Input
                                    id="description"
                                    placeholder="그룹에 대한 설명"
                                    value={newGroupDesc}
                                    onChange={(e) => setNewGroupDesc(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreating(false)}>
                                취소
                            </Button>
                            <Button onClick={handleCreateGroup} disabled={createGroup.isPending}>
                                {createGroup.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                생성하기
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>그룹 목록</CardTitle>
                    <CardDescription>등록된 그룹과 멤버 정보를 확인할 수 있습니다</CardDescription>
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
                                        <TableHead>그룹 이름</TableHead>
                                        <TableHead>설명</TableHead>
                                        <TableHead>멤버 수</TableHead>
                                        <TableHead>Super Admin</TableHead>
                                        <TableHead>생성 일시</TableHead>
                                        <TableHead className="text-right">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {groups && groups.length > 0 ? (
                                        groups.map((group) => (
                                            <TableRow key={group.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <Users className="w-4 h-4 text-muted-foreground" />
                                                        {group.name}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {group.description || '-'}
                                                </TableCell>
                                                <TableCell>{group.members.length}</TableCell>
                                                <TableCell>
                                                    {group.permissions.superAdmin ? (
                                                        <Shield className="w-4 h-4 text-red-500" />
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {new Date(group.created_at).toLocaleDateString('ko-KR')}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button variant="ghost" size="icon">
                                                            <Settings className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteGroup(group.id, group.name)}
                                                            disabled={deleteGroupMutation.isPending}
                                                        >
                                                            <Trash2 className="w-4 h-4 text-red-500" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                그룹이 없습니다
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
