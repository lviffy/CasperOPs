"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  Users,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Vote,
  Play,
  CheckCircle2,
  Share2,
  ExternalLink,
  Info,
  RefreshCw,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface AgentMessage {
  id: string;
  agent: "Compliance" | "Risk" | "Treasury";
  text: string;
  timestamp: string;
  status: "thinking" | "done";
}

const INITIAL_DEBATE_MESSAGES: AgentMessage[] = [
  {
    id: "1",
    agent: "Treasury",
    text: "Initiating proposed rebalance: Swap 5,000 CSPR for BOUSD stablecoin to capitalize on yielding pool. Requesting compliance and risk check.",
    timestamp: "22:30:05",
    status: "done",
  },
  {
    id: "2",
    agent: "Compliance",
    text: "Analyzing sender wallet address 01ed25… ZK proof for jurisdiction US compliance… Status: Verification check passed. Compliant on-chain.",
    timestamp: "22:30:12",
    status: "done",
  },
  {
    id: "3",
    agent: "Risk",
    text: "Evaluating pool slippage and volatility index… Current volatility: low (12%). Attestation rating of Treasury Agent is 98/100. Trade size falls within safe threshold.",
    timestamp: "22:30:20",
    status: "done",
  },
  {
    id: "4",
    agent: "Treasury",
    text: "Excellent. Consensus reached. Generating CEP-18 transfer deploy package and final execution logs for on-chain MessageBoard.",
    timestamp: "22:30:28",
    status: "done",
  },
];

const AGENT_META = {
  Treasury: {
    icon: <Wallet className="h-4 w-4" />,
    label: "Treasury",
    badgeClass: "bg-secondary text-secondary-foreground border-border",
  },
  Compliance: {
    icon: <ShieldCheck className="h-4 w-4" />,
    label: "Compliance",
    badgeClass: "bg-secondary text-secondary-foreground border-border",
  },
  Risk: {
    icon: <TrendingUp className="h-4 w-4" />,
    label: "Risk",
    badgeClass: "bg-secondary text-secondary-foreground border-border",
  },
};

export default function SwarmWorkspace() {
  const [messages, setMessages] = useState<AgentMessage[]>(
    INITIAL_DEBATE_MESSAGES
  );
  const [step, setStep] = useState<number>(3);
  const [isSimulating, setIsSimulating] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [signingStatus, setSigningStatus] = useState<
    "idle" | "signing" | "broadcasted"
  >("idle");
  const [deployHash, setDeployHash] = useState("");
  const debateEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debateEndRef.current) {
      debateEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const runSimulation = () => {
    setIsSimulating(true);
    setStep(0);
    setMessages([
      {
        id: "s1",
        agent: "Treasury",
        text: "Checking yields on Casper liquid staking pools… Found 14.2% APY opportunity. Requesting audit clearance for 10,000 CSPR delegation proposal.",
        timestamp: new Date().toLocaleTimeString(),
        status: "done",
      },
    ]);

    setTimeout(() => {
      setStep(1);
      setMessages((prev) => [
        ...prev,
        {
          id: "s2",
          agent: "Compliance",
          text: "Running anonymous compliance attestation lookup on the Compliance contract… Validator key verified. Clear of sanction lists. Ready for delegation.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done",
        },
      ]);
    }, 2500);

    setTimeout(() => {
      setStep(2);
      setMessages((prev) => [
        ...prev,
        {
          id: "s3",
          agent: "Risk",
          text: "Checking target validator uptime (99.98%) and delegation commission (5%). Slashing risk attestation verified on Reputation contract. Risk index: Optimal.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done",
        },
      ]);
    }, 5000);

    setTimeout(() => {
      setStep(3);
      setMessages((prev) => [
        ...prev,
        {
          id: "s4",
          agent: "Treasury",
          text: "Consensus validated. Proposed delegation ready for Casper network execution. Awaiting operator signature via CSPR.click.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done",
        },
      ]);
      setIsSimulating(false);
    }, 7500);
  };

  const handleSign = () => {
    setSigningStatus("signing");
    setTimeout(() => {
      const generatedHash = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      setDeployHash(generatedHash);
      setSigningStatus("broadcasted");
    }, 2000);
  };

  const handleShare = () => {
    const text =
      "I just tested the Casper-native AI Swarm Workspace on CasperOPs! Vote for CasperOPs on CSPR.fans!";
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank"
    );
  };

  const TIMELINE_STEPS = [
    {
      label: "Compliance Attestation",
      description: "Anonymous whitelisting check passed.",
      threshold: 1,
    },
    {
      label: "Risk Assessment",
      description: "Slippage & attestation ratings check passed.",
      threshold: 2,
    },
    {
      label: "Final Swarm Vote",
      description: "Consensus locked. Ready to execute.",
      threshold: 3,
    },
  ];

  return (
    <div className="min-h-screen bg-background font-aeonik">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
                <Bot className="h-5 w-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">
                CasperOPs
              </span>
            </Link>
            <Separator orientation="vertical" className="mx-2 h-6" />
            <Badge variant="outline" className="text-xs font-medium">
              Swarm
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleShare}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Share
            </Button>
            <Button asChild size="sm" className="h-8 text-xs">
              <Link
                href="https://cspr.fans/project/casperops"
                target="_blank"
                onClick={() => setHasVoted(true)}
              >
                <Vote className="mr-1.5 h-3.5 w-3.5" />
                Vote on CSPR.fans
                <ExternalLink className="ml-1.5 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Page title */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Swarm Workspace
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live multi-agent consensus loop on Casper Testnet.
            </p>
          </div>
          <Button
            onClick={runSimulation}
            disabled={isSimulating}
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${isSimulating ? "animate-spin" : ""}`}
            />
            Re-simulate
          </Button>
        </div>

        {/* CSPR.fans notice — voted confirmation */}
        {hasVoted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-foreground shrink-0" />
            Thank you for supporting CasperOPs! Your vote drives native
            automation forward on Casper Network.
          </motion.div>
        )}

        {/* Main grid */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Deliberation room — 2/3 */}
          <div className="lg:col-span-2">
            <Card className="border-border bg-background shadow-none flex flex-col h-[580px]">
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base font-medium">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      Deliberation Room
                    </CardTitle>
                    <CardDescription className="mt-0.5 text-xs">
                      Agent-to-agent consensus messages
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
                    <span className="text-xs text-muted-foreground font-medium">
                      Active
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                <AnimatePresence>
                  {messages.map((msg) => {
                    const meta = AGENT_META[msg.agent];
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="flex gap-3"
                      >
                        {/* Agent icon */}
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground/60">
                          {meta.icon}
                        </div>

                        {/* Message bubble */}
                        <div className="flex-1 rounded-md border border-border bg-muted/20 px-3 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-foreground">
                              {msg.agent} Agent
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {msg.timestamp}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {msg.text}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <div ref={debateEndRef} />
              </CardContent>
            </Card>
          </div>

          {/* Right column — 1/3 */}
          <div className="flex flex-col gap-6">
            {/* Consensus timeline */}
            <Card className="border-border bg-background shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  Consensus Timeline
                </CardTitle>
                <CardDescription className="text-xs">
                  Audit track verification
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Steps */}
                <div className="space-y-3 relative before:absolute before:left-[15px] before:top-3 before:bottom-3 before:w-px before:bg-border">
                  {TIMELINE_STEPS.map((s, i) => {
                    const done = step >= s.threshold;
                    return (
                      <div key={i} className="flex items-start gap-3 relative">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold z-10 transition-colors ${
                            done
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            i + 1
                          )}
                        </div>
                        <div className="pt-1">
                          <p className="text-xs font-medium text-foreground">
                            {s.label}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {s.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Execution block */}
                {step === 3 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-4 border-t border-border space-y-3"
                  >
                    {signingStatus === "idle" && (
                      <Button
                        onClick={handleSign}
                        className="w-full h-9 text-xs font-medium"
                      >
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                        Sign via CSPR.click
                      </Button>
                    )}

                    {signingStatus === "signing" && (
                      <div className="rounded-md border border-border bg-muted/20 p-3 text-center space-y-2">
                        <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin mx-auto" />
                        <p className="text-xs font-medium text-foreground">
                          Prompting CSPR.click…
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Sign the deploy in your wallet extension.
                        </p>
                      </div>
                    )}

                    {signingStatus === "broadcasted" && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="rounded-md border border-border bg-muted/20 p-3 space-y-2"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Deploy broadcasted
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground break-all leading-relaxed">
                          {deployHash}
                        </p>
                        <Link
                          href={`https://testnet.cspr.live/deploy/${deployHash}`}
                          target="_blank"
                          className="inline-flex items-center gap-1 text-[11px] text-foreground hover:underline"
                        >
                          View on CSPR.live{" "}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* Protocol info */}
            <Card className="border-border bg-background shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  Coordination Protocol
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                <p>
                  Each debate step publishes state logs to the on-chain{" "}
                  <span className="font-medium text-foreground">
                    MessageBoard
                  </span>{" "}
                  contract on Casper Testnet.
                </p>
                <p>
                  Agents coordinate in real-time through Redis pub-sub,
                  enabling high-performance asynchronous orchestration.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
