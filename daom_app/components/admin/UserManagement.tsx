'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Shield, Search, X, Building,
    Loader2, FolderPlus, Trash2, Plus, UserPlus, Globe, ChevronDown, ChevronRight, Upload, Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    getPermissionGroups,
    createPermissionGroup,
    updatePermissionGroup,
    deletePermissionGroup,
    addMemberToGroup,
    removeMemberFromGroup,
    updateGroupPermissions,
    searchEntraUsers,
    searchEntraGroups
} from '@/actions/permission';
import { listExtractionModels } from '@/actions/extractionModel';
import { PermissionGroup, ModelPermission } from '@/scheme/permission';
import { useSession } from 'next-auth/react';
import { BulkUserImport } from './BulkUserImport';

type SearchType = 'user' | 'entra_group' | 'local_user';

interface EntraUser {
    id: string;
    displayName: string;
    mail: string;
    userPrincipalName: string;
}

interface EntraGroup {
    id: string;
    displayName: string;
    description: string;
}

export function UserManagement() {
    const { data: session } = useSession();
    const isCurrentUserSuperAdmin = session?.user?.roles?.some((role: any) => role === 'DAOM.SuperAdmin' || role === 'SuperAdmin');

    // State
    const [groups, setGroups] = useState<PermissionGroup[]>([]);
    const [models, setModels] = useState<{ id: string, name: string, is_super_model?: boolean }[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [showBulkImportModal, setShowBulkImportModal] = useState(false);

    // Create/Edit Group Modal
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupDesc, setGroupDesc] = useState('');
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [isEditingGroup, setIsEditingGroup] = useState(false);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

    // If not super admin, ensure we don't accidentally set super admin permissions
    useEffect(() => {
        if (!isCurrentUserSuperAdmin) {
            setIsSuperAdmin(false);
            setPermSuperAdmin(false);
        }
    }, [isCurrentUserSuperAdmin]);

    // Add Member Modal
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<PermissionGroup | null>(null);
    const [memberSearchType, setMemberSearchType] = useState<SearchType>('local_user');
    const [memberSearchTerm, setMemberSearchTerm] = useState('');
    const [entraSearchResults, setEntraSearchResults] = useState<(EntraUser | EntraGroup)[]>([]);
    const [addingMember, setAddingMember] = useState(false);
    const [graphLoading, setGraphLoading] = useState(false);
    const [graphError, setGraphError] = useState<string | null>(null);

    // Permission Settings Modal
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [editingGroupPermissions, setEditingGroupPermissions] = useState<PermissionGroup | null>(null);
    const [permSuperAdmin, setPermSuperAdmin] = useState(false);
    const [permModels, setPermModels] = useState<ModelPermission[]>([]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [groupsData, modelsData] = await Promise.all([
                getPermissionGroups(),
                listExtractionModels({ offset: 0, pageSize: 1000, keyword: null, isActive: undefined }),
            ]);
            setGroups(groupsData);
            setModels((modelsData as any[]).map(m => ({
                id: m.id,
                name: m.name,
                is_super_model: m.is_super_model
            })));
        } catch (error) {
            console.error('Failed to fetch data:', error);
            toast.error('데이터를 불러오는데 실패했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Member Search Effect
    useEffect(() => {
        if (!showAddMemberModal || memberSearchTerm.length < 2) {
            setEntraSearchResults([]);
            return;
        }

        const doSearch = async () => {
            setGraphLoading(true);
            setGraphError(null);
            try {
                if (memberSearchType === 'user' || memberSearchType === 'local_user') {
                    // Assuming local_user search uses the same logic for now, or implement separate local user search action
                    // For now, implementing Entra search for both as per requested scope functionality
                    const results = await searchEntraUsers(memberSearchTerm);
                    setEntraSearchResults(results as any);
                } else if (memberSearchType === 'entra_group') {
                    const results = await searchEntraGroups(memberSearchTerm);
                    setEntraSearchResults(results as any);
                }
            } catch (e) {
                console.error(e);
                setGraphError('검색에 실패했습니다.');
            } finally {
                setGraphLoading(false);
            }
        };

        const timer = setTimeout(doSearch, 300);
        return () => clearTimeout(timer);
    }, [memberSearchTerm, memberSearchType, showAddMemberModal]);

    const filteredGroups = groups.filter(group =>
        group.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCreateGroup = async () => {
        if (!groupName.trim()) return;
        setCreatingGroup(true);
        try {
            if (isEditingGroup && editingGroupId) {
                await updatePermissionGroup(editingGroupId, groupName, groupDesc);
                toast.success('그룹 정보가 수정되었습니다');
            } else {
                await createPermissionGroup(groupName, groupDesc, isSuperAdmin);
                toast.success('권한 그룹이 생성되었습니다');
            }
            setShowGroupModal(false);
            setGroupName('');
            setGroupDesc('');
            setIsSuperAdmin(false);
            setIsEditingGroup(false);
            setEditingGroupId(null);
            fetchData();
        } catch {
            toast.error(isEditingGroup ? '그룹 수정에 실패했습니다' : '그룹 생성에 실패했습니다');
        } finally {
            setCreatingGroup(false);
        }
    };

    const openCreateModal = () => {
        setIsEditingGroup(false);
        setEditingGroupId(null);
        setGroupName('');
        setGroupDesc('');
        setIsSuperAdmin(false);
        setShowGroupModal(true);
    };

    const openEditModal = (group: PermissionGroup) => {
        setIsEditingGroup(true);
        setEditingGroupId(group.id);
        setGroupName(group.name);
        setGroupDesc(group.description || '');
        setIsSuperAdmin(group.permissions?.superAdmin || false);
        setShowGroupModal(true);
    };

    const handleDeleteGroup = async (groupId: string) => {
        if (!confirm('이 권한 그룹을 삭제하시겠습니까?')) return;
        try {
            await deletePermissionGroup(groupId);
            toast.success('그룹이 삭제되었습니다');
            fetchData();
        } catch {
            toast.error('그룹 삭제에 실패했습니다');
        }
    };

    const handleAddMember = async (item: EntraUser | EntraGroup) => {
        if (!selectedGroup) return;
        setAddingMember(true);
        try {
            const type = memberSearchType === 'entra_group' ? 'entra_group' : 'user';

            await addMemberToGroup(selectedGroup.id, {
                type,
                id: item.id,
                displayName: item.displayName || (item as any).name || 'Unknown'
            });

            toast.success('멤버가 추가되었습니다');
            fetchData();
            setMemberSearchTerm('');
            setEntraSearchResults([]);
        } catch {
            toast.error('멤버 추가에 실패했습니다');
        } finally {
            setAddingMember(false);
        }
    };

    const handleRemoveMember = async (groupId: string, memberId: string) => {
        try {
            await removeMemberFromGroup(groupId, memberId);
            toast.success('멤버가 제거되었습니다');
            fetchData();
        } catch {
            toast.error('멤버 제거에 실패했습니다');
        }
    };

    const openPermissionsModal = (group: PermissionGroup) => {
        setEditingGroupPermissions(group);
        setPermSuperAdmin(group.permissions?.superAdmin || false);
        setPermModels(group.permissions?.models || []);
        setShowPermissionsModal(true);
    };

    const handleSavePermissions = async () => {
        if (!editingGroupPermissions) return;
        try {
            await updateGroupPermissions(editingGroupPermissions.id, permSuperAdmin, permModels);
            toast.success('권한이 저장되었습니다');
            setShowPermissionsModal(false);
            fetchData();
        } catch {
            toast.error('권한 저장에 실패했습니다');
        }
    };




    const toggleExpand = (groupId: string) => {
        setExpandedGroup(prev => prev === groupId ? null : groupId);
    };

    return (
        <div className="space-y-6 p-10 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-xl">
                        <Shield className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-foreground">권한 그룹 관리</h2>
                        <p className="text-sm text-muted-foreground">그룹을 만들고 Entra 사용자/그룹을 추가하여 권한을 관리합니다</p>
                    </div>
                </div>
                {isCurrentUserSuperAdmin && (
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setShowBulkImportModal(true)}>
                            <Upload className="w-4 h-4 mr-2" />
                            일괄 등록
                        </Button>
                        <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                            <FolderPlus className="w-4 h-4 mr-2" />
                            권한 그룹 생성
                        </Button>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                    type="text"
                    placeholder="권한 그룹 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-background shadow-sm"
                />
            </div>

            {/* Permission Groups List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : groups.length === 0 ? (
                    <div className="bg-muted/30 rounded-2xl border-2 border-dashed border-border text-center py-16 px-4">
                        <div className="bg-card w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-border">
                            <Shield className="w-10 h-10 text-muted-foreground/40" />
                        </div>
                        <h3 className="text-lg font-bold text-foreground mb-2">권한 그룹이 없습니다</h3>
                        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto whitespace-pre-wrap">
                            권한 그룹을 생성하고 Entra ID의 사용자나 보안 그룹을 추가하여
                            모델과 메뉴에 대한 접근 권한을 관리하세요
                        </p>
                        {isCurrentUserSuperAdmin && (
                            <Button onClick={openCreateModal} className="bg-blue-600 hover:bg-blue-700 text-white">
                                <FolderPlus className="w-5 h-5 mr-2" />
                                첫 권한 그룹 만들기
                            </Button>
                        )}
                    </div>
                ) : (
                    filteredGroups.map(group => (
                        <Card key={group.id} className="overflow-hidden hover:shadow-md transition-all duration-200 border-border">
                            {/* Group Header */}
                            <div
                                className="flex items-center justify-between p-5 cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => toggleExpand(group.id)}
                            >
                                <div className="flex items-center gap-4 flex-1">
                                    {expandedGroup === group.id ?
                                        <ChevronDown className="w-5 h-5 text-muted-foreground" /> :
                                        <ChevronRight className="w-5 h-5 text-muted-foreground/60" />
                                    }

                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className="font-bold text-foreground text-lg">{group.name}</h3>
                                            {group.permissions?.superAdmin && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-red-500 dark:bg-red-600 text-white rounded-full shadow-sm">
                                                    <Shield className="w-3 h-3" />
                                                    관리자
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-1.5">
                                                <div className="flex -space-x-2">
                                                    {group.members?.slice(0, 3).map((_, i) => (
                                                        <div key={i} className="w-6 h-6 rounded-full bg-muted border-2 border-card" />
                                                    ))}
                                                </div>
                                                <span className="font-medium">{group.members?.length || 0}</span> 멤버
                                            </div>
                                            <span className="text-muted-foreground/30">•</span>
                                            <span className="font-medium">{group.permissions?.models?.length || 0}</span> 모델 권한
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                    <Button size="sm" onClick={() => openPermissionsModal(group)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                                        권한 설정
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEditModal(group) }} className="hover:bg-accent">
                                        정보 수정
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => { setSelectedGroup(group); setShowAddMemberModal(true); setMemberSearchTerm(''); setEntraSearchResults([]); }} className="hover:bg-accent">
                                        <UserPlus className="w-4 h-4 mr-1" />
                                        멤버 추가
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Expanded Content */}
                            {expandedGroup === group.id && (
                                <div className="px-5 pb-5 pt-0 border-t border-border bg-muted/20">
                                    <div className="grid grid-cols-2 gap-6 mt-5">
                                        {/* Members Section */}
                                        <Card className="p-4 border-border shadow-sm">
                                            <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                                <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                                                멤버 목록
                                            </h4>
                                            {group.members?.length === 0 ? (
                                                <div className="text-center py-6">
                                                    <p className="text-sm text-muted-foreground">아직 멤버가 없습니다</p>
                                                    <button
                                                        onClick={() => { setSelectedGroup(group); setShowAddMemberModal(true); setMemberSearchTerm(''); setEntraSearchResults([]); }}
                                                        className="mt-2 text-xs text-blue-500 hover:text-blue-600 hover:underline"
                                                    >
                                                        멤버 추가하기
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {group.members?.map((member) => (
                                                        <div key={member.id} className="flex items-center justify-between p-2 bg-card rounded border border-border">
                                                            <span>{member.displayName}</span>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveMember(group.id, member.id)}>
                                                                <X className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </Card>

                                        {/* Permissions Section */}
                                        <Card className="p-4 border-border shadow-sm">
                                            <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                                                <div className="w-1.5 h-4 bg-green-500 rounded-full" />
                                                권한 요약
                                            </h4>
                                            <div className="text-sm text-muted-foreground">
                                                {group.permissions?.superAdmin ? '관리자 권한' : '개별 권한 설정됨'}
                                                {/* Details could be added here similar to before project if needed */}
                                                {!group.permissions?.superAdmin && (
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        {group.permissions?.models?.map(m => (
                                                            <span key={m.modelId} className="px-2 py-0.5 bg-muted rounded text-xs">{m.modelName}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    </div>
                                </div>
                            )}
                        </Card>
                    ))
                )}
            </div>

            {/* Create Group Modal */}
            {showGroupModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <Card className="p-6 w-full max-w-md bg-card shadow-xl border-border animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-foreground mb-4">{isEditingGroup ? '권한 그룹 수정' : '권한 그룹 생성'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">그룹 이름</label>
                                <Input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 마케팅팀" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">설명</label>
                                <Input type="text" value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} placeholder="그룹에 대한 설명" />
                            </div>
                            {isCurrentUserSuperAdmin && (
                                <label className="flex items-center gap-3 p-3 bg-red-500/10 rounded-lg cursor-pointer border border-red-500/20">
                                    <input type="checkbox" checked={isSuperAdmin} onChange={(e) => setIsSuperAdmin(e.target.checked)} className="rounded border-red-500/50 text-red-500 focus:ring-red-200" />
                                    <div>
                                        <div className="font-semibold text-red-500">관리자</div>
                                        <div className="text-xs text-red-500/80">이 그룹의 멤버는 모든 메뉴와 모델에 대한 접근 권한을 가집니다.</div>
                                    </div>
                                </label>
                            )}
                            {isEditingGroup && <p className="text-xs text-muted-foreground">권한 설정은 그룹 생성 후 &apos;권한 설정&apos; 버튼을 통해 가능합니다.</p>}
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <Button variant="ghost" onClick={() => setShowGroupModal(false)}>취소</Button>
                            <Button onClick={handleCreateGroup} disabled={creatingGroup} className="bg-primary text-primary-foreground hover:bg-primary/90">
                                {creatingGroup ? '저장 중...' : (isEditingGroup ? '수정' : '생성')}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Add Member Modal */}
            {showAddMemberModal && selectedGroup && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <Card className="p-6 w-full max-w-lg bg-card shadow-xl border-border animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-foreground mb-4">&quot;{selectedGroup.name}&quot; 멤버 추가</h3>

                        <div className="flex gap-2 mb-4">
                            <Button
                                variant={memberSearchType === 'local_user' ? 'default' : 'outline'}
                                className={`flex-1 ${memberSearchType === 'local_user' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-accent'}`}
                                onClick={() => setMemberSearchType('local_user')}
                            >
                                로컬 사용자
                            </Button>
                            <Button
                                variant={memberSearchType === 'user' ? 'default' : 'outline'}
                                className={`flex-1 ${memberSearchType === 'user' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-accent'}`}
                                onClick={() => setMemberSearchType('user')}
                            >
                                Entra 사용자
                            </Button>
                            <Button
                                variant={memberSearchType === 'entra_group' ? 'default' : 'outline'}
                                className={`flex-1 ${memberSearchType === 'entra_group' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-accent'}`}
                                onClick={() => setMemberSearchType('entra_group')}
                            >
                                Entra 보안 그룹
                            </Button>
                        </div>

                        <div className="relative mb-4">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                type="text"
                                value={memberSearchTerm}
                                onChange={(e) => setMemberSearchTerm(e.target.value)}
                                placeholder={memberSearchType === 'entra_group' ? "그룹명으로 검색..." : "이름 또는 이메일로 검색..."}
                                className="pl-9"
                            />
                        </div>

                        {graphError && <p className="text-sm text-red-500 mb-2">{graphError}</p>}

                        <div className="max-h-64 overflow-auto space-y-1 border border-border rounded-md p-1">
                            {graphLoading ? (
                                <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                            ) : entraSearchResults.length === 0 ? (
                                <p className="text-center text-muted-foreground py-4">{memberSearchTerm.length >= 2 ? "검색 결과가 없습니다" : "2글자 이상 입력하세요"}</p>
                            ) : (
                                entraSearchResults.map((item, idx) => (
                                    <div key={item.id || idx} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-lg transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${memberSearchType === 'entra_group' ? 'bg-indigo-600' : 'bg-slate-400 dark:bg-slate-600'}`}>
                                                {memberSearchType === 'entra_group' ? <Globe className="w-4 h-4" /> :
                                                    (('displayName' in item && item.displayName) || ('name' in item && (item as any).name) || '?').slice(0, 1)}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium">{'displayName' in item ? item.displayName : (item as any).name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {memberSearchType === 'local_user' ? (item as any).email :
                                                        memberSearchType === 'user' ? (item as EntraUser).mail :
                                                            (item as EntraGroup).description || 'Entra 보안 그룹'}
                                                </div>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => handleAddMember(item)} disabled={addingMember} className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex justify-end mt-4">
                            <Button variant="ghost" onClick={() => setShowAddMemberModal(false)}>닫기</Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Permissions Modal */}
            {showPermissionsModal && editingGroupPermissions && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <Card className="p-6 w-full max-w-lg max-h-[85vh] overflow-auto bg-card shadow-xl border-border animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-foreground mb-4">&quot;{editingGroupPermissions.name}&quot; 권한 설정</h3>

                        {isCurrentUserSuperAdmin && (
                            <label className="flex items-center gap-3 mb-6 p-4 bg-red-500/10 rounded-xl border border-red-500/20 cursor-pointer">
                                <input type="checkbox" checked={permSuperAdmin} onChange={(e) => setPermSuperAdmin(e.target.checked)} className="rounded border-red-500/50 text-red-600 focus:ring-red-200" />
                                <div>
                                    <div className="font-semibold text-red-500">관리자</div>
                                    <div className="text-xs text-red-500/80">이 그룹의 멤버는 모든 메뉴와 모델에 대한 접근 권한을 가집니다.</div>
                                </div>
                            </label>
                        )}

                        {!permSuperAdmin && (
                            <div className="space-y-6">
                                <div>
                                    <h4 className="font-bold text-foreground mb-3 flex items-center gap-2">
                                        <div className="w-1 h-4 bg-primary rounded-full" />
                                        모델 접근 권한
                                    </h4>
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                        {models.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">등록된 모델이 없습니다</p>
                                        ) : (
                                            models.map(model => {
                                                const perm = permModels.find(m => m.modelId === model.id);
                                                return (
                                                    <div key={model.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium">{model.name}</span>
                                                        {model.is_super_model && (
                                                            <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 py-0 px-1.5 h-4.5 text-[10px] flex gap-1 items-center">
                                                                <Layers className="w-2.5 h-2.5" />
                                                                상위 모델
                                                            </Badge>
                                                        )}
                                                    </div>
                                                        <div className="flex gap-1">
                                                            <Button
                                                                variant={!perm ? 'secondary' : 'ghost'}
                                                                size="sm"
                                                                onClick={() => setPermModels(prev => prev.filter(m => m.modelId !== model.id))}
                                                                className={`h-7 px-2 text-xs ${!perm ? 'bg-muted text-muted-foreground' : 'text-muted-foreground/50'}`}
                                                            >
                                                                없음
                                                            </Button>
                                                            <Button
                                                                variant={perm?.role === 'User' ? 'default' : 'ghost'}
                                                                size="sm"
                                                                onClick={() => setPermModels(prev => {
                                                                    const others = prev.filter(m => m.modelId !== model.id);
                                                                    return [...others, { modelId: model.id, modelName: model.name, role: 'User' }];
                                                                })}
                                                                className={`h-7 px-2 text-xs ${perm?.role === 'User' ? 'bg-blue-600 text-white' : 'text-muted-foreground/50'}`}
                                                            >
                                                                사용자
                                                            </Button>
                                                            <Button
                                                                variant={perm?.role === 'Admin' ? 'default' : 'ghost'}
                                                                size="sm"
                                                                onClick={() => setPermModels(prev => {
                                                                    const others = prev.filter(m => m.modelId !== model.id);
                                                                    return [...others, { modelId: model.id, modelName: model.name, role: 'Admin' }];
                                                                })}
                                                                className={`h-7 px-2 text-xs ${perm?.role === 'Admin' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground/50'}`}
                                                            >
                                                                관리자
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                            </div>
                        )}

                        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
                            <Button variant="ghost" onClick={() => setShowPermissionsModal(false)}>취소</Button>
                            <Button onClick={handleSavePermissions} className="bg-primary text-primary-foreground hover:bg-primary/90">
                                저장
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Info */}
            <div className="flex items-start gap-4 p-5 bg-blue-500/10 text-foreground rounded-2xl border border-blue-500/20 shadow-sm">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Building className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                    <div className="font-bold text-lg mb-1">권한 그룹 사용 가이드</div>
                    <div className="text-sm text-muted-foreground leading-relaxed">
                        1. <strong>권한 그룹 생성</strong> 버튼을 눌러 새로운 그룹을 만드세요.<br />
                        2. 생성된 그룹에 <strong>Entra 사용자</strong> 또는 <strong>보안 그룹</strong>을 멤버로 추가하세요.<br />
                        3. <strong>권한 설정</strong>을 통해 해당 그룹이 접근할 수 있는 모델을 지정하세요.
                    </div>
                </div>
            </div>

            <BulkUserImport
                open={showBulkImportModal}
                onOpenChange={setShowBulkImportModal}
                onSuccess={fetchData}
            />
        </div>
    );
}
