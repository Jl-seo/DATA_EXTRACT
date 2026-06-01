'use client';

import { ShieldAlert, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut } from 'next-auth/react';

interface AccessDeniedProps {
    userEmail?: string | null;
}

export default function AccessDenied({ userEmail }: AccessDeniedProps) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 border border-slate-100 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-rose-500 ring-4 ring-rose-50/50">
                    <ShieldAlert className="w-10 h-10" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">접근 권한이 없습니다</h1>
                <p className="text-slate-500 mb-6 leading-relaxed">
                    시스템 사용자 관리에 등록되지 않은 계정입니다.<br />
                    서비스 이용을 위해 관리자에게 승인을 요청해주세요.
                </p>

                <div className="bg-slate-50 rounded-xl p-4 mb-8 text-left border border-slate-100">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">현재 접속 계정</p>
                    <p className="text-sm font-medium text-slate-700 truncate">{userEmail || '알 수 없는 사용자'}</p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <Button
                        variant="ghost"
                        className="w-full h-12 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 font-medium"
                        onClick={() => signOut({ callbackUrl: '/', redirect: true })}
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        로그아웃 후 다른 계정으로 로그인
                    </Button>
                </div>
            </div>

            <p className="mt-8 text-xs text-slate-400">
                &copy; {new Date().getFullYear()} DAOM AI Platform. All rights reserved.
            </p>
        </div>
    );
}
