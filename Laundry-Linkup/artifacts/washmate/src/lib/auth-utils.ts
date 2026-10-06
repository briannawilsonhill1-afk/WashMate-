const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Redirect to the Clerk sign-in page with an optional toast notification.
export function redirectToLogin(
  toast?: (options: { title: string; description: string; variant: string }) => void,
) {
  if (toast) {
    toast({
      title: 'Unauthorized',
      description: 'You are logged out. Sending you to sign in...',
      variant: 'destructive',
    });
  }
  setTimeout(() => {
    window.location.href = `${basePath}/sign-in`;
  }, 500);
}
