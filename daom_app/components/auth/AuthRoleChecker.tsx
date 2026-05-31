import { redirect } from "next/navigation";
import PermissionService, { GlobalRole } from "@/services/PermissionService";
import { ModelPermission } from "@/scheme/permission";
import AuthClientChecker from "./AuthClientChecker";
import { getCurrentEnvConfig } from "@/lib/env";
import AccessDenied from "./AccessDenied";

export default async function AuthRoleChecker({
  children,
  hasRoles,
  allowNone = false,
  allowModelAdmins = false
}: {
  children: React.ReactNode,
  hasRoles?: GlobalRole[],
  allowNone?: boolean,
  allowModelAdmins?: boolean
}) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  const globalRole = await permissionService.getGlobalRole();
  const modelRoles = await permissionService.getUserModelRoles();

  if (!globalRole) {
    // 로그인이 안되어있으면 로그아웃
    redirect('/auth/logout');
  }

  // allowNone이 false인 경우에만 'none' 권한 차단
  if (globalRole === 'none' && !allowNone) {
    // 등록되지 않은 사용자면 AccessDenied UI 노출 (튕겨내지 않음)
    return <AccessDenied userEmail={user?.upn} />;
  }

  // 특정 역할이 요구되는 경우 (hasRoles 존재 시)
  if (hasRoles && !hasRoles.includes(globalRole)) {
    // allowModelAdmins가 true이고 모델 관리자 권한을 가진 모델이 1개라도 있다면 통과
    const isModelAdmin = modelRoles.some((m: ModelPermission) => m.role === 'Admin');
    if (!(allowModelAdmins && isModelAdmin)) {
      // 권한이 없으면 /로 redirect
      redirect('/');
    }
  }

  return (
    <AuthClientChecker globalRole={globalRole} modelRoles={modelRoles}>
      {children}
    </AuthClientChecker>
  )
}