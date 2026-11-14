import { useSearch } from '@tanstack/react-router';
import { LoginPage } from '@/features/auth/LoginPage';

export function LoginRoute() {
  const { error } = useSearch({ strict: false }) as { error?: string };
  return <LoginPage error={error} />;
}
