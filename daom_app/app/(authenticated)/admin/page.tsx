//import { redirect } from "next/navigation";

import { UserManagement } from '@/components/admin/UserManagement';

export default function AdminUserManagementPage() {
  return <UserManagement />;
  //redirect('/admin/general');
}
