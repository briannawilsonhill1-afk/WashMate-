import { lazy, Suspense, useEffect, useRef } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
} from "@clerk/react";
import { shadcn } from "@clerk/themes";
import {
  Switch,
  Route,
  Redirect,
  Router as WouterRouter,
  useLocation,
} from "wouter";
import { queryClient } from "./lib/queryClient";
import {
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { useAuth } from "@/hooks/use-auth";
import { usePushRegistration } from "@/hooks/use-push-registration";
import LandingPage from "@/pages/AuthPage";
import { updatePublicPageJsonLd } from "@/seo/structured-data";

// Route-level code splitting: only the landing page ships in the initial bundle.
// Authenticated and secondary routes are fetched on demand.
const RoleSelection = lazy(() => import("@/pages/RoleSelection"));
const CustomerDashboard = lazy(() => import("@/pages/CustomerDashboard"));
const WasherDashboard = lazy(() => import("@/pages/WasherDashboard"));
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const WasherProfile = lazy(() => import("@/pages/WasherProfile"));
const OrderDetail = lazy(() => import("@/pages/OrderDetail"));
const Incidents = lazy(() => import("@/pages/Incidents"));
const Settings = lazy(() => import("@/pages/Settings"));
const RevenueDashboard = lazy(() => import("@/pages/RevenueDashboard"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Navbar = lazy(() =>
  import("@/components/layout/Navbar").then((module) => ({
    default: module.Navbar,
  })),
);

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// In dev this is empty (Clerk loads JS straight from the dev FAPI domain
// encoded in the publishable key). In production it's set so Clerk Frontend
// API calls are proxied through our domain.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const canonicalOrigin = "https://washloop.net";
const socialImageUrl = `${canonicalOrigin}/opengraph.jpg`;

type PageMetadata = {
  title: string;
  description: string;
  robots: "index, follow" | "noindex, nofollow";
  canonical?: string;
};

const publicPageMetadata: Record<"/" | "/privacy", PageMetadata> = {
  "/": {
    title: "WashMate | Local Laundry Pickup and Delivery",
    description:
      "Laundry day, finally simplified. Schedule pickups and get fresh laundry delivered.",
    robots: "index, follow",
    canonical: `${canonicalOrigin}/`,
  },
  "/privacy": {
    title: "Privacy Policy | WashMate",
    description:
      "Learn how WashMate protects customer information, belongings, addresses, and privacy.",
    robots: "index, follow",
    canonical: `${canonicalOrigin}/privacy`,
  },
};

function getPrivatePageMetadata(path: string): PageMetadata | undefined {
  const title = path.startsWith("/sign-in")
    ? "Sign In | WashMate"
    : path.startsWith("/sign-up")
      ? "Create an Account | WashMate"
      : path === "/welcome"
        ? "Choose Your Role | WashMate"
        : path === "/customer"
          ? "Customer Dashboard | WashMate"
          : path === "/washer"
            ? "Washer Dashboard | WashMate"
            : path === "/washer/profile"
              ? "Washer Profile | WashMate"
              : path.startsWith("/orders/")
                ? "Order Details | WashMate"
                : path === "/settings"
                  ? "Settings | WashMate"
                  : path.startsWith("/incidents") ||
                      path.startsWith("/admin/incidents")
                    ? "Incident Support | WashMate"
                    : path === "/admin/revenue"
                      ? "Revenue Dashboard | WashMate"
                      : undefined;

  return title
    ? {
        title,
        description: "Secure WashMate account page.",
        robots: "noindex, nofollow",
      }
    : undefined;
}

function setMetaContent(selector: string, content: string) {
  const element = document.head.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element.content = content;
    return;
  }

  const meta = document.createElement("meta");
  const propertyMatch = selector.match(/^meta\[property="(.+)"\]$/);
  const nameMatch = selector.match(/^meta\[name="(.+)"\]$/);
  if (propertyMatch) meta.setAttribute("property", propertyMatch[1]);
  if (nameMatch) meta.name = nameMatch[1];
  meta.content = content;
  document.head.append(meta);
}

function useRouteMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    const normalizedPath =
      location !== "/" ? location.replace(/\/+$/, "") : location;
    const publicMetadata =
      publicPageMetadata[normalizedPath as keyof typeof publicPageMetadata];
    updatePublicPageJsonLd(
      normalizedPath === "/" ? "landing" : normalizedPath === "/privacy" ? "privacy" : null,
    );
    const metadata: PageMetadata =
      publicMetadata ??
      getPrivatePageMetadata(normalizedPath) ?? {
        title: "Page Not Found | WashMate",
        description: "The requested WashMate page could not be found.",
        robots: "noindex, nofollow",
      };

    document.title = metadata.title;
    setMetaContent('meta[name="description"]', metadata.description);
    setMetaContent('meta[name="robots"]', metadata.robots);
    setMetaContent('meta[property="og:title"]', metadata.title);
    setMetaContent('meta[property="og:description"]', metadata.description);
    setMetaContent(
      'meta[property="og:url"]',
      metadata.canonical ?? `${canonicalOrigin}${normalizedPath}`,
    );
    setMetaContent('meta[property="og:type"]', "website");
    setMetaContent('meta[property="og:image"]', socialImageUrl);
    setMetaContent('meta[property="og:site_name"]', "WashMate");
    setMetaContent('meta[name="twitter:card"]', "summary_large_image");

    const canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (metadata.canonical) {
      const link = canonical ?? document.createElement("link");
      link.rel = "canonical";
      link.href = metadata.canonical;
      if (!canonical) document.head.append(link);
    } else {
      canonical?.remove();
    }
  }, [location]);
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in environment");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(214, 100%, 50%)",
    colorForeground: "hsl(222, 47%, 11%)",
    colorMutedForeground: "hsl(215, 16%, 47%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(210, 40%, 98%)",
    colorInputForeground: "hsl(222, 47%, 11%)",
    colorNeutral: "hsl(214, 32%, 91%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-border/50",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-display font-bold text-2xl",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary font-semibold hover:underline",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    formButtonPrimary:
      "bg-primary hover:bg-primary/90 text-white font-semibold",
    formFieldInput:
      "bg-secondary/50 border border-border/50 text-foreground rounded-xl",
  },
};

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  allowedRole,
}: {
  component: any;
  allowedRole: "customer" | "washer";
}) {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/" />;
  if (!user?.role) return <Redirect to="/welcome" />;

  if (user.role !== allowedRole) {
    return (
      <Redirect to={user.role === "customer" ? "/customer" : "/washer"} />
    );
  }

  return <Component />;
}

function HomeRedirect() {
  const { user, isLoading, isAuthenticated } = useAuth();
  // Render useful public content immediately while Clerk checks the session.
  // This avoids making first paint and LCP wait on third-party authentication.
  if (isLoading) return <LandingPage />;
  if (!isAuthenticated) return <LandingPage />;
  if (!user?.role) return <Redirect to="/welcome" />;
  return <Redirect to={user.role === "customer" ? "/customer" : "/washer"} />;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function Router() {
  const { isAuthenticated } = useAuth();
  usePushRegistration();
  useRouteMetadata();

  return (
    <div className="min-h-screen flex flex-col">
      {isAuthenticated && (
        <Suspense fallback={null}>
          <Navbar />
        </Suspense>
      )}
      <main className="flex-1">
        <Suspense fallback={<LoadingScreen />}>
          <Switch>
            <Route path="/" component={HomeRedirect} />

            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/welcome">
              <Show when="signed-in">
                <RoleSelection />
              </Show>
              <Show when="signed-out">
                <Redirect to="/" />
              </Show>
            </Route>

            <Route path="/customer">
              <ProtectedRoute
                component={CustomerDashboard}
                allowedRole="customer"
              />
            </Route>

            <Route path="/washer">
              <ProtectedRoute component={WasherDashboard} allowedRole="washer" />
            </Route>

            <Route path="/washer/profile">
              <ProtectedRoute component={WasherProfile} allowedRole="washer" />
            </Route>

            <Route path="/orders/:id">
              <Show when="signed-in">
                <OrderDetail />
              </Show>
              <Show when="signed-out">
                <Redirect to="/" />
              </Show>
            </Route>

            <Route path="/settings">
              <Show when="signed-in">
                <Settings />
              </Show>
              <Show when="signed-out">
                <Redirect to="/" />
              </Show>
            </Route>

            <Route path="/incidents/:id" component={Incidents} />
            <Route path="/incidents" component={Incidents} />
            <Route path="/admin/incidents/:id" component={Incidents} />
            <Route path="/admin/incidents" component={Incidents} />
            <Route path="/admin/revenue" component={RevenueDashboard} />
            <Route path="/privacy">
              <PrivacyPolicy />
            </Route>

            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to your WashMate account",
          },
        },
        signUp: {
          start: {
            title: "Create your WashMate account",
            subtitle: "Get fresh, folded laundry delivered",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
