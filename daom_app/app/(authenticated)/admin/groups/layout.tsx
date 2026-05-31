import AuthRoleChecker from "@/components/auth/AuthRoleChecker";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthRoleChecker hasRoles={['admin']}>{children}</AuthRoleChecker>
}
