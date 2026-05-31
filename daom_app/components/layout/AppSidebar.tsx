'use client';

import { Activity, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import useSettings from '@/hooks/useSettings';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Palette,
  LayoutDashboard,
  ClipboardList,
  History,
  Users,
  User,
  FileText,
  Settings,
  Moon,
  Sun,
  LogOut,
  BookOpen
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { signOut, useSession } from 'next-auth/react';

import { useMetaPromptFeature, useSiteConfig } from '@/queries/env';

import { GlobalRole } from '@/services/PermissionService';
import { useAuth } from '../auth/AuthClientChecker';

type MenuItem = {
  name: string;
  href?: string;
  icon: any;
  items?: { name: string; href: string; icon: any }[];
  allowedRoles?: GlobalRole[];
};

export default function AppSidebar() {
  const { data: session } = useSession();
  const { data: siteConfig } = useSiteConfig();
  const { data: isMetaPromptEnabled = false } = useMetaPromptFeature();
  const { globalRole, modelRoles } = useAuth();
  
  const isModelAdmin = useMemo(() => {
    return modelRoles?.some(m => m.role === 'Admin') || false;
  }, [modelRoles]);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['모델 관리', '시스템 설정']); // Default expanded
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL에서 상세조회(logId 포함)나 모델 실행(/extraction/run) 페이지 진입 시 사이드바 접기
  useEffect(() => {
    if (pathname.startsWith('/extraction/run/')) {
      setTimeout(() => setIsCollapsed(true), 0);
    }
  }, [pathname, searchParams]);

  const isVisible = useMemo(() => {
    return !pathname.startsWith('/auth');
  }, [pathname]);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const toggleGroup = (name: string) => {
    if (isCollapsed) return;
    setExpandedGroups(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const menuItems: MenuItem[] = [
    {
      name: '문서 추출',
      href: '/extraction',
      icon: FileText,
    },
    {
      name: '모델 관리',
      icon: Palette,
      items: [
        ...(globalRole === 'admin' || isModelAdmin ? [{ name: '모델 스튜디오', href: '/admin/model-studio', icon: ClipboardList }] : []),
        { name: '모델 갤러리', href: '/models', icon: LayoutDashboard },
      ]
    },
    ...(isMetaPromptEnabled && (globalRole === 'admin' || isModelAdmin) ? [{
      name: '프롬프트 워크벤치',
      href: '/prompt-workbench',
      icon: BookOpen,
    }] : []),
    ...(globalRole === 'admin' || isModelAdmin ? [{
      name: '시스템 설정',
      icon: Users,
      items: [
        ...(globalRole === 'admin' ? [
          { name: '대시보드', href: '/admin/dashboard', icon: LayoutDashboard },
          { name: '통합 사전 관리', href: '/admin/dictionary', icon: BookOpen },
          { name: '활동 로그', href: '/admin/audit', icon: ClipboardList },
          { name: '일반 설정', href: '/admin/general', icon: Settings },
        ] : []),
        { name: '사용자 관리', href: '/admin/users', icon: Users },
      ]
    }] : []),
    {
      name: '전체 추출 기록',
      href: '/extraction/history',
      icon: History,
      allowedRoles: ['admin'],
    }
  ];

  const renderMenuItem = (item: MenuItem) => {
    // Permission Check: unregistered users see no menu items
    if (globalRole === 'none') {
      return null;
    }

    if (item.allowedRoles && !item.allowedRoles.includes(globalRole)) {
      return null;
    }

    const isActive = item.href ? pathname.startsWith(item.href) : false;
    const isExpanded = expandedGroups.includes(item.name);
    const hasSubmenu = !!item.items;

    // ... rest of renderMenuItem ...

    // Parent Item
    const parentContent = (
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 group relative select-none cursor-pointer',
          isActive && !hasSubmenu
            ? 'bg-sidebar-accent text-sidebar-primary font-medium'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          isCollapsed && 'justify-center p-2'
        )}
        onClick={() => {
          // If sidebar is collapsed, open it first
          if (isCollapsed) {
            setIsCollapsed(false);
            if (hasSubmenu && !expandedGroups.includes(item.name)) {
              toggleGroup(item.name);
            }
          } else {
            if (hasSubmenu) {
              toggleGroup(item.name);
            }
          }
        }}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <item.icon
            className={cn(
              'w-5 h-5 shrink-0 transition-colors',
              isActive && !hasSubmenu ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground'
            )}
          />
          {!isCollapsed && (
            <span className="whitespace-nowrap overflow-hidden text-sm">
              {item.name}
            </span>
          )}
        </div>

        {!isCollapsed && hasSubmenu && (
          <ChevronDown
            className={cn(
              "w-4 h-4 text-sidebar-foreground/50 transition-transform duration-200",
              isExpanded ? "transform rotate-180" : ""
            )}
          />
        )}
      </div>
    );

    const wrappedParent = item.href && !hasSubmenu ? (
      <Link href={item.href} key={item.name} className="block mb-1">
        {parentContent}
      </Link>
    ) : (
      <div key={item.name} className="mb-1">
        {parentContent}
      </div>
    );

    // Collapsed Tooltip logic
    if (isCollapsed) {
      return (
        <Tooltip key={item.name} delayDuration={0}>
          <TooltipTrigger asChild>
            {item.href ? <Link href={item.href} className="block mb-1">{parentContent}</Link> : <div className="mb-1">{parentContent}</div>}
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-sidebar-foreground text-sidebar border-sidebar-border">
            {item.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div key={item.name}>
        {wrappedParent}

        {/* Submenu */}
        {!isCollapsed && hasSubmenu && isExpanded && (
          <div className="ml-4 pl-3 border-l border-sidebar-border space-y-1 mt-1 mb-2">
            {item.items!.map(sub => {
              const isSubActive = pathname === sub.href;
              return (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
                    isSubActive
                      ? "text-sidebar-primary font-medium bg-sidebar-accent"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <sub.icon className="w-4 h-4 opacity-70" />
                  <span>{sub.name}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* Check if user is super admin */
  const isSuperAdmin = useMemo(() => {
    return session?.user?.roles?.some(role => role === 'DAOM.SuperAdmin' || role === 'SuperAdmin');
  }, [session]);

  const { setTheme, resolvedTheme } = useTheme();
  const { updateTheme } = useSettings();

  const toggleTheme = () => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    updateTheme(newTheme);
  };

  return (
    <Activity mode={isVisible ? 'visible' : 'hidden'}>
      <TooltipProvider>
        <aside
          className={cn(
            'h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out relative z-20 shadow-sm',
            isCollapsed ? 'w-20' : 'w-64',
          )}
        >
          {/* Header / Branding */}
          <div className={cn(
            "h-16 flex items-center px-4 border-b border-sidebar-border shrink-0 relative",
            isCollapsed ? "justify-center" : "justify-between"
          )}>
            {!isCollapsed && (
              <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                {siteConfig?.app_favicon?.src ? (
                  <img
                    src={siteConfig.app_favicon.src}
                    alt="Logo"
                    className="w-9 h-9 object-contain"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                ) : (
                  <img
                    src="/logo.png"
                    alt="Logo"
                    className="w-10 h-10 object-contain"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                )}
                <div className="flex flex-col leading-none">
                  <span className="font-bold text-xl text-sidebar-foreground tracking-tight">
                    {siteConfig?.app_name || 'DAOM'}
                  </span>
                  <span className="text-xs text-sidebar-foreground/70 font-medium tracking-tight">
                    {siteConfig?.app_description || '문서 자동화'}
                  </span>
                </div>
              </div>
            )}
            {isCollapsed ? (
              <div className="w-full flex justify-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="rounded-full hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground h-8 w-8"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="rounded-full hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
          </div>

          {/* Quick Action Button (Hidden by request) */}
          {/* 
          {!isCollapsed ? (
            <div className="px-4 my-6">
              <Button
                asChild
                className="w-full h-11 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 shadow-lg shadow-blue-200 dark:shadow-none transition-all duration-300"
              >
                <Link href="/quick-extraction">
                  <div className="relative flex w-full items-center justify-center">
                    <span className="text-lg absolute left-4">⚡</span>
                    <span className="font-medium">빠른 추출 시작</span>
                  </div>
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex justify-center w-full my-6">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    size="icon"
                    className="w-10 h-10 shrink-0 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 shadow-lg shadow-blue-200 dark:shadow-none"
                  >
                    <Link href="/quick-extraction">
                      <span className="text-lg flex items-center justify-center h-full w-full">⚡</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">빠른 추출 시작</TooltipContent>
              </Tooltip>
            </div>
          )}
          */}

          {/* Menu */}
          <ScrollArea className="flex-1 px-3 mt-4">
            <div className="space-y-1.5">
              {menuItems.map(renderMenuItem)}
            </div>
          </ScrollArea>

          {/* User Profile Footer */}
          <div className="p-4 border-t border-sidebar-border bg-sidebar shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div
                  className={cn(
                    'flex items-center gap-3 transition-all duration-300 cursor-pointer group hover:bg-sidebar-accent/50 p-2 rounded-xl',
                    isCollapsed ? 'justify-center' : '',
                  )}
                >
                  {session ? (
                    <Avatar className={cn(
                      "w-9 h-9 border-none transition-all duration-200 shadow-md",
                      isSuperAdmin && "ring-2 ring-blue-600"
                    )}>
                      <AvatarImage src="/api/profile-images/me" />
                      <AvatarFallback className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white font-bold">
                        {session.user.name?.[0] || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-sidebar-foreground/50" />
                    </div>
                  )}

                  {!isCollapsed && (
                    <div className="flex-1 overflow-hidden min-w-0">
                      <p className="font-bold text-sm text-sidebar-foreground truncate leading-none mb-1">
                        {session?.user.name}
                      </p>
                      <p className="text-[10px] text-sidebar-foreground/50 truncate font-medium">
                        {session?.user.email || session?.user.upn}
                      </p>
                    </div>
                  )}

                  {!isCollapsed && (
                    <ChevronUp className="w-4 h-4 text-sidebar-foreground/30 group-hover:text-sidebar-foreground transition-colors" />
                  )}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-64 mb-2 p-2 rounded-2xl shadow-2xl border-sidebar-border bg-sidebar/95 backdrop-blur-md"
              >
                <DropdownMenuLabel className="px-3 py-3 border-b border-sidebar-border/50 mb-1">
                  <p className="text-xs font-bold text-sidebar-foreground/90 truncate">
                    {session?.user.email || session?.user.upn}
                  </p>
                </DropdownMenuLabel>

                <DropdownMenuGroup className="space-y-1">
                  <Link href="/profile">
                    <DropdownMenuItem className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-sidebar-accent transition-colors">
                      <User className="w-4 h-4" />
                      <span className="text-sm font-medium">사용자</span>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/admin/general">
                    <DropdownMenuItem className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-sidebar-accent transition-colors">
                      <Settings className="w-4 h-4" />
                      <span className="text-sm font-medium">설정</span>
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuItem
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-sidebar-accent transition-colors"
                    onClick={toggleTheme}
                  >
                    {resolvedTheme === 'dark' ? (
                      <>
                        <Sun className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-medium">라이트 모드</span>
                      </>
                    ) : (
                      <>
                        <Moon className="w-4 h-4 text-indigo-400" />
                        <span className="text-sm font-medium">다크 모드</span>
                      </>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator className="my-2 bg-sidebar-border/50" />

                <DropdownMenuItem
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-500 hover:text-rose-600 hover:bg-rose-50 focus:text-rose-600 focus:bg-rose-50 cursor-pointer transition-colors"
                  onClick={() => signOut({ callbackUrl: '/', redirect: true })}
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm font-bold">로그아웃</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>
      </TooltipProvider>
    </Activity>
  );
}
