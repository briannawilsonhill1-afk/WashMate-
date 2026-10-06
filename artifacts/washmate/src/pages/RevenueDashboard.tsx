import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, DollarSign, RefreshCw, Users } from 'lucide-react';
import { Link, Redirect } from 'wouter';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useAuth } from '@/hooks/use-auth';
import { incidentRequest, money, useIncidentAccess } from '@/hooks/use-incidents';

type RevenueDashboardData = {
  currency: 'usd';
  refreshedAt: string;
  refreshSchedule: string;
  currentMrrCents: number;
  monthly: Array<{
    month: string;
    label: string;
    mrrCents: number;
    newMrrCents: number;
    churnedMrrCents: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    email: string | null;
    mrrCents: number;
  }>;
};

const axisMoney = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value / 100);

export default function RevenueDashboard() {
  const { isAuthenticated, isLoading } = useAuth();
  const access = useIncidentAccess();
  const revenue = useQuery({
    queryKey: ['/api/admin/revenue'],
    queryFn: () => incidentRequest<RevenueDashboardData>('/api/admin/revenue'),
    enabled: !!access.data?.isAdmin,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) return <p role="status" className="p-8">Loading account…</p>;
  if (!isAuthenticated) return <Redirect to="/" />;

  const latest = revenue.data?.monthly.at(-1);
  const previous = revenue.data?.monthly.at(-2);
  const change = latest && previous ? latest.mrrCents - previous.mrrCents : 0;

  return (
    <main className="container mx-auto px-4 py-8 space-y-8">
      <Link href="/customer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to WashMate
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Stripe revenue</p>
          <h1 className="mt-1 text-3xl font-display font-bold">Revenue dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Recurring revenue trends and the customers driving them.
          </p>
        </div>
        <Button variant="outline" disabled={revenue.isFetching || !access.data?.isAdmin} onClick={() => void revenue.refetch()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${revenue.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </header>

      {access.isLoading && <p role="status">Checking administrator access…</p>}
      {access.data && !access.data.isAdmin && (
        <div role="alert" className="rounded-2xl border bg-card p-6">
          This dashboard is restricted to WashMate administrators.
        </div>
      )}
      {revenue.error && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-destructive">
          Revenue data is temporarily unavailable. Try refreshing in a moment.
        </div>
      )}

      {revenue.data && (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Monthly recurring revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{money(revenue.data.currentMrrCents)}</p>
                <p className={`mt-2 flex items-center text-sm ${change >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                  {change >= 0 ? <ArrowUpRight className="mr-1 h-4 w-4" /> : <ArrowDownRight className="mr-1 h-4 w-4" />}
                  {money(Math.abs(change))} from last month
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">New MRR this month</CardTitle>
                <ArrowUpRight className="h-4 w-4 text-emerald-700" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{money(latest?.newMrrCents ?? 0)}</p>
                <p className="mt-2 text-sm text-muted-foreground">Recurring revenue added</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Churned MRR this month</CardTitle>
                <ArrowDownRight className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{money(latest?.churnedMrrCents ?? 0)}</p>
                <p className="mt-2 text-sm text-muted-foreground">Recurring revenue lost</p>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader>
                <CardTitle>Monthly MRR</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{ mrrCents: { label: 'MRR', color: 'hsl(var(--primary))' } }} className="h-[320px] w-full">
                  <LineChart data={revenue.data.monthly} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={64} />
                    <ChartTooltip content={<ChartTooltipContent formatter={value => money(Number(value))} />} />
                    <Line dataKey="mrrCents" type="monotone" stroke="var(--color-mrrCents)" strokeWidth={3} dot={false} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>New versus churned MRR</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{
                  newMrrCents: { label: 'New MRR', color: '#047857' },
                  churnedMrrCents: { label: 'Churned MRR', color: '#dc2626' },
                }} className="h-[320px] w-full">
                  <BarChart data={revenue.data.monthly} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={60} />
                    <ChartTooltip content={<ChartTooltipContent formatter={value => money(Number(value))} />} />
                    <Bar dataKey="newMrrCents" fill="var(--color-newMrrCents)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="churnedMrrCents" fill="var(--color-churnedMrrCents)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Top customers</CardTitle>
              <span className="text-xs text-muted-foreground">Ranked by current MRR</span>
            </CardHeader>
            <CardContent>
              {revenue.data.topCustomers.length === 0 ? (
                <p className="rounded-xl bg-secondary/50 p-5 text-sm text-muted-foreground">
                  No active recurring Stripe subscriptions yet.
                </p>
              ) : (
                <div className="divide-y">
                  {revenue.data.topCustomers.map((customer, index) => (
                    <div key={customer.id} className="flex items-center justify-between gap-4 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{customer.name}</p>
                          {customer.email && <p className="truncate text-sm text-muted-foreground">{customer.email}</p>}
                        </div>
                      </div>
                      <p className="shrink-0 font-bold">{money(customer.mrrCents)} <span className="text-xs font-normal text-muted-foreground">MRR</span></p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Refreshed {new Date(revenue.data.refreshedAt).toLocaleString()} · {revenue.data.refreshSchedule}
          </p>
        </>
      )}
    </main>
  );
}