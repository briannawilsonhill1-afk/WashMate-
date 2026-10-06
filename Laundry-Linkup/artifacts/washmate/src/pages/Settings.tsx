import { useEffect, useState } from "react";
import { ArrowLeft, Bell, BellOff } from "lucide-react";
import { Link } from "wouter";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  getCurrentDeviceToken,
  isPushEnabled,
  registerCurrentToken,
  setPushEnabled,
  subscribeToNativeToken,
  unregisterCurrentToken,
} from "@/lib/device-token";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const userId = user?.id ?? "";
  const [nativeToken, setNativeToken] = useState(() => getCurrentDeviceToken());
  const hasNativeToken = Boolean(nativeToken);
  const [enabled, setEnabled] = useState(() => Boolean(userId) && isPushEnabled(userId));
  const [saving, setSaving] = useState(false);
  const dashboardPath = user?.role === "washer" ? "/washer" : "/customer";

  useEffect(() => {
    if (userId) setEnabled(isPushEnabled(userId));
  }, [userId]);

  useEffect(() => {
    return subscribeToNativeToken(setNativeToken);
  }, []);

  const updateNotifications = async (nextEnabled: boolean) => {
    if (!userId || !hasNativeToken || saving) return;

    setSaving(true);
    if (!setPushEnabled(userId, nextEnabled)) {
      setSaving(false);
      toast({
        variant: "destructive",
        title: "Notifications preference not saved",
        description: "Enable site storage or clear browser storage space, then try again.",
      });
      return;
    }
    setEnabled(nextEnabled);

    const ok = nextEnabled
      ? await registerCurrentToken(userId)
      : await unregisterCurrentToken(userId);

    if (!ok) {
      setEnabled(!nextEnabled);
      setPushEnabled(userId, !nextEnabled);
      toast({
        variant: "destructive",
        title: "Could not update notifications",
        description: "Check your connection and try again.",
      });
    } else {
      toast({
        title: nextEnabled ? "Notifications turned on" : "Notifications turned off",
        description: nextEnabled
          ? "You'll receive updates for your WashMate account."
          : "This device will no longer receive WashMate push notifications.",
      });
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Link href={dashboardPath}>
          <span className="mb-6 inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </span>
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Bell className="h-7 w-7" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight" data-testid="text-settings-title">
              Settings
            </h1>
            <p className="text-muted-foreground">Manage your app preferences.</p>
          </div>
        </div>

        <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="flex gap-4">
              <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                {enabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
              </div>
              <div>
                <label htmlFor="push-notifications" className="font-display font-semibold">
                  Push notifications
                </label>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Receive order updates and alerts on this device.
                </p>
                {!hasNativeToken && (
                  <p className="mt-3 text-sm text-muted-foreground" data-testid="text-notifications-unavailable">
                    Push notifications are available in the WashMate mobile app.
                  </p>
                )}
              </div>
            </div>
            <Switch
              id="push-notifications"
              checked={enabled && hasNativeToken}
              disabled={!hasNativeToken || saving}
              onCheckedChange={updateNotifications}
              aria-label="Push notifications"
              data-testid="switch-push-notifications"
            />
          </div>
        </section>
      </div>
    </div>
  );
}