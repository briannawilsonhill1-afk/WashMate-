import { useQuery } from "@tanstack/react-query";
import { useAuth as useClerkAuth, useClerk } from "@clerk/react";
import type { User } from "@/lib/api";
import { unregisterCurrentToken } from "@/lib/device-token";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export function useAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const clerk = useClerk();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    enabled: isLoaded && !!isSignedIn,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  return {
    user: isSignedIn ? user ?? null : null,
    isLoading: !isLoaded || (isSignedIn && isLoading),
    isAuthenticated: !!isSignedIn,
    logout: () => {
      void unregisterCurrentToken(user?.id).finally(() => {
        void clerk.signOut();
      });
    },
    isLoggingOut: false,
  };
}
