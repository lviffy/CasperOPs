"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend } from "recharts";
import { ArrowLeft, Coins, Cpu, Zap, CreditCard } from "lucide-react";

type AnalyticsData = {
  ok: boolean;
  summary: {
    totalSpentCspr: number;
    cacheSavingsCspr: number;
    totalToolCalls: number;
    cachedToolCalls: number;
    activeTier: string;
    subscriptionStatus: string;
  };
  charts: {
    dailySpend: Array<{
      date: string;
      spend: number;
      savings: number;
      calls: number;
      cachedCalls: number;
    }>;
    toolDistribution: Array<{
      tool: string;
      count: number;
      spend: number;
    }>;
  };
};

export default function BillingAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAnalytics() {
    try {
      setLoading(true);
      setError(null);
      // Retrieve the master/session API key or credentials
      const res = await fetch("/billing/analytics", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load analytics: HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error || "Failed to fetch analytics data");
      }
      setData(json);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics();
  }, []);

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-[350px] w-full" />
          <Skeleton className="h-[350px] w-full" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-5xl text-center space-y-4">
        <h1 className="text-2xl font-bold text-destructive">Failed to Load Analytics</h1>
        <p className="text-muted-foreground">{error || "No data available."}</p>
        <Link href="/billing" className="inline-flex items-center gap-2 text-primary underline">
          <ArrowLeft className="h-4 w-4" /> Back to Billing
        </Link>
      </main>
    );
  }

  const { summary, charts } = data;
  const efficiencyRatio = summary.totalToolCalls > 0 
    ? ((summary.cachedToolCalls / summary.totalToolCalls) * 100).toFixed(1)
    : "0.0";

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
            Billing & x402 Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time Casper tool execution fees, caching efficiency, and subscription state.
          </p>
        </div>
        <Link
          href="/billing"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Billing
        </Link>
      </header>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden border-border bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total CSPR Spent</CardTitle>
            <Coins className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalSpentCspr.toFixed(2)} CSPR</div>
            <p className="text-xs text-muted-foreground mt-1">Direct tool execution fees</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cache Savings</CardTitle>
            <Zap className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">+{summary.cacheSavingsCspr.toFixed(2)} CSPR</div>
            <p className="text-xs text-muted-foreground mt-1">Saved via JWT / cache hits</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cache Efficiency</CardTitle>
            <Cpu className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{efficiencyRatio}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.cachedToolCalls} of {summary.totalToolCalls} calls cached
            </p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Subscription Tier</CardTitle>
            <CreditCard className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{summary.activeTier}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Status: <span className="text-violet-400 font-semibold">{summary.subscriptionStatus}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Daily Spend & Savings */}
        <Card className="border-border bg-card/30">
          <CardHeader>
            <CardTitle>Daily Spend & Cache Savings</CardTitle>
            <CardDescription>CSPR spent vs saved over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.dailySpend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSavings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="date" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "rgba(17, 17, 17, 0.9)", border: "1px solid rgba(255, 255, 255, 0.1)" }}
                  labelClassName="text-sm font-semibold text-white"
                />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Area type="monotone" name="Spent (CSPR)" dataKey="spend" stroke="#f59e0b" fillOpacity={1} fill="url(#colorSpend)" />
                <Area type="monotone" name="Saved (CSPR)" dataKey="savings" stroke="#10b981" fillOpacity={1} fill="url(#colorSavings)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tool Distribution */}
        <Card className="border-border bg-card/30">
          <CardHeader>
            <CardTitle>Fee Allocation by Tool</CardTitle>
            <CardDescription>Total CSPR spent per Casper tool</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.toolDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="tool" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "rgba(17, 17, 17, 0.9)", border: "1px solid rgba(255, 255, 255, 0.1)" }}
                />
                <Bar name="Spend (CSPR)" dataKey="spend" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Daily Tool Calls Summary */}
      <Card className="border-border bg-card/30">
        <CardHeader>
          <CardTitle>Execution & Caching Breakdown</CardTitle>
          <CardDescription>Daily breakdown of total tool calls and cache hits</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Total Calls</th>
                <th className="py-3 px-4">Cache Hits</th>
                <th className="py-3 px-4">CSPR Spent</th>
                <th className="py-3 px-4">CSPR Saved</th>
              </tr>
            </thead>
            <tbody>
              {charts.dailySpend.map((row) => (
                <tr key={row.date} className="border-b border-border/30 hover:bg-muted/10 transition-colors">
                  <td className="py-3 px-4 font-medium">{row.date}</td>
                  <td className="py-3 px-4">{row.calls}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      {row.cachedCalls} ({row.calls > 0 ? ((row.cachedCalls / row.calls) * 100).toFixed(0) : 0}%)
                    </span>
                  </td>
                  <td className="py-3 px-4">{row.spend.toFixed(2)} CSPR</td>
                  <td className="py-3 px-4 text-emerald-400">+{row.savings.toFixed(2)} CSPR</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
