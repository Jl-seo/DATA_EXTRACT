'use client';

import { useSession } from 'next-auth/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { User, Mail, Shield, ShieldCheck, Clock, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ProfilePage() {
    const { data: session } = useSession();
    const user = session?.user;

    const profileData = {
        name: user?.name || '사용자',
        email: user?.email || user?.upn || '이메일 정보 없음',
        orgId: '69c1e470-4528-435a-a1ae-de98e0aac738', // Mock placeholder as requested
        role: (user?.roles as any[])?.some(r => r === 'Admin' || r === 'DAOM.SuperAdmin' || r === 'SuperAdmin') ? 'Admin' : 'User',
        lastLogin: '지금',
        authMethod: 'Microsoft Entra ID'
    };

    return (
        <div className="p-8 max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Banner - Premium Gradient */}
            <div className="relative h-48 rounded-3xl bg-gradient-to-r from-sky-500 via-purple-500 to-rose-500 shadow-2xl flex items-center px-10 overflow-hidden group">
                {/* Decorative background elements */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl group-hover:bg-white/20 transition-all duration-700" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full -ml-16 -mb-16 blur-2xl" />

                <div className="flex items-center gap-8 relative z-10">
                    <Avatar className="w-28 h-28 border-4 border-white/20 shadow-2xl group-hover:scale-105 transition-transform duration-500">
                        <AvatarImage src="/api/profile-images/me" />
                        <AvatarFallback className="bg-white/20 text-white text-4xl font-black backdrop-blur-md">
                            {profileData.name[0]}
                        </AvatarFallback>
                    </Avatar>
                    <div className="text-white">
                        <h1 className="text-4xl font-black tracking-tighter mb-1">{profileData.name}</h1>
                        <div className="flex items-center gap-2 opacity-90 font-medium tracking-tight">
                            <Mail className="w-4 h-4" />
                            <span>{profileData.email}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="info" className="w-full">
                <TabsList className="bg-transparent border-none p-0 h-auto gap-4 mb-8">
                    <TabsTrigger
                        value="info"
                        className="data-[state=active]:bg-sky-500 data-[state=active]:text-white rounded-xl px-6 py-2.5 text-sm font-black transition-all shadow-none data-[state=active]:shadow-lg active:scale-95 border border-border/40"
                    >
                        프로필 정보
                    </TabsTrigger>
                    <TabsTrigger
                        value="security"
                        className="data-[state=active]:bg-sky-500 data-[state=active]:text-white rounded-xl px-6 py-2.5 text-sm font-black transition-all shadow-none data-[state=active]:shadow-lg active:scale-95 border border-border/40"
                    >
                        보안
                    </TabsTrigger>
                </TabsList>

                {/* Profile Information Tab */}
                <TabsContent value="info" className="outline-none focus-visible:ring-0">
                    <Card className="border-border/40 shadow-xl shadow-black/5 rounded-3xl overflow-hidden bg-muted/20 backdrop-blur-sm">
                        <CardContent className="p-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                {/* Name Input Style */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-muted-foreground ml-1">
                                        <User className="w-4 h-4" />
                                        <span className="text-[13px] font-bold">이름</span>
                                    </div>
                                    <div className="bg-muted px-5 py-4 rounded-2xl text-foreground font-semibold border border-transparent hover:border-border/60 transition-colors shadow-inner">
                                        {profileData.name}
                                    </div>
                                </div>

                                {/* Email Input Style */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-muted-foreground ml-1">
                                        <Mail className="w-4 h-4" />
                                        <span className="text-[13px] font-bold">이메일</span>
                                    </div>
                                    <div className="bg-muted px-5 py-4 rounded-2xl text-foreground font-semibold border border-transparent hover:border-border/60 transition-colors shadow-inner">
                                        {profileData.email}
                                    </div>
                                </div>

                                {/* Organization ID Style */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-muted-foreground ml-1">
                                        <Building2 className="w-4 h-4" />
                                        <span className="text-[13px] font-bold">조직 ID</span>
                                    </div>
                                    <div className="bg-muted px-5 py-4 rounded-2xl text-muted-foreground font-mono text-[13px] border border-transparent hover:border-border/60 transition-colors shadow-inner">
                                        {profileData.orgId}
                                    </div>
                                </div>

                                {/* Role Style */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-muted-foreground ml-1">
                                        <Shield className="w-4 h-4" />
                                        <span className="text-[13px] font-bold">역할</span>
                                    </div>
                                    <div className="bg-muted px-5 py-4 rounded-2xl flex items-center border border-transparent hover:border-border/60 transition-colors shadow-inner">
                                        <Badge variant="outline" className="bg-sky-100/50 text-sky-600 border-sky-200/50 font-bold px-3">
                                            {profileData.role}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Security Tab */}
                <TabsContent value="security" className="outline-none focus-visible:ring-0">
                    <Card className="border-border/40 shadow-xl shadow-black/5 rounded-3xl overflow-hidden bg-muted/20 backdrop-blur-sm">
                        <CardContent className="p-10 space-y-6">
                            {/* Last Login Section */}
                            <div className="bg-muted px-6 py-5 rounded-2xl border border-transparent hover:border-border/60 transition-all flex items-center gap-5 shadow-inner">
                                <div className="bg-white p-3 rounded-xl shadow-sm">
                                    <Clock className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[13px] font-bold text-foreground">마지막 로그인</span>
                                    <span className="text-xs text-muted-foreground font-medium">{profileData.lastLogin}</span>
                                </div>
                            </div>

                            {/* Authentication Method Section */}
                            <div className="bg-muted px-6 py-5 rounded-2xl border border-transparent hover:border-border/60 transition-all flex items-center justify-between shadow-inner">
                                <div className="flex items-center gap-5">
                                    <div className="bg-white p-3 rounded-xl shadow-sm">
                                        <ShieldCheck className="w-5 h-5 text-green-500" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-bold text-foreground transition-colors group-hover:text-primary">인증 방식</span>
                                        <span className="text-xs text-muted-foreground font-medium">{profileData.authMethod}</span>
                                    </div>
                                </div>
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-3 font-bold text-[10px]">활성</Badge>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
