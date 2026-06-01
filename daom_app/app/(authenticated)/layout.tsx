import AuthRoleChecker from '@/components/auth/AuthRoleChecker';
import AppSidebar from '@/components/layout/AppSidebar';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* Outer Layer: Provides role context to the layout (Sidebar, etc.) but allows 'none' role */
    <AuthRoleChecker allowNone={true}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar will be visible even for 'none' role, but items will be hidden inside AppSidebar.tsx */}
        <AppSidebar />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto transition-all duration-300">
          {/* Inner Layer: Strictly blocks 'none' role and shows AccessDenied UI */}
          <AuthRoleChecker hasRoles={['admin', 'user']}>
            {children}
          </AuthRoleChecker>
        </main>
      </div>
    </AuthRoleChecker>
  );
}
