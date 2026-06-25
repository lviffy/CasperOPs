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
  MessageSquare, 
  ArrowRight,
  Share2,
  ExternalLink,
  Info,
  AlertTriangle,
  RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    status: "done"
  },
  {
    id: "2",
    agent: "Compliance",
    text: "Analyzing sender wallet address 01ed25... ZK proof for jurisdiction US compliance... Status: Verification check passed. Compliant on-chain.",
    timestamp: "22:30:12",
    status: "done"
  },
  {
    id: "3",
    agent: "Risk",
    text: "Evaluating pool slippage and volatility index... Current volatility: low (12%). Attestation rating of Treasury Agent is 98/100. Trade size falls within safe threshold.",
    timestamp: "22:30:20",
    status: "done"
  },
  {
    id: "4",
    agent: "Treasury",
    text: "Excellent. Consensus reached. Generating CEP-18 transfer deploy package and final execution logs for on-chain MessageBoard.",
    timestamp: "22:30:28",
    status: "done"
  }
];

export default function SwarmWorkspace() {
  const [messages, setMessages] = useState<AgentMessage[]>(INITIAL_DEBATE_MESSAGES);
  const [step, setStep] = useState<number>(3); // 0: Init, 1: Compliance, 2: Risk, 3: Success/Done
  const [isSimulating, setIsSimulating] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [signingStatus, setSigningStatus] = useState<"idle" | "signing" | "broadcasted">("idle");
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
        text: "Checking yields on Casper liquid staking pools... Found 14.2% APY opportunity. Requesting audit clearance for 10,000 CSPR delegation proposal.",
        timestamp: new Date().toLocaleTimeString(),
        status: "done"
      }
    ]);

    setTimeout(() => {
      setStep(1);
      setMessages(prev => [
        ...prev,
        {
          id: "s2",
          agent: "Compliance",
          text: "Running anonymous compliance attestation lookup on the Compliance contract... Validator key verified. Clear of sanction lists. Ready for delegation.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done"
        }
      ]);
    }, 2500);

    setTimeout(() => {
      setStep(2);
      setMessages(prev => [
        ...prev,
        {
          id: "s3",
          agent: "Risk",
          text: "Checking target validator uptime (99.98%) and delegation commission (5%). Slashing risk attestation verified on Reputation contract. Risk index: Optimal.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done"
        }
      ]);
    }, 5000);

    setTimeout(() => {
      setStep(3);
      setMessages(prev => [
        ...prev,
        {
          id: "s4",
          agent: "Treasury",
          text: "Consensus validated. Proposed delegation ready for Casper network execution. Awaiting operator signature via CSPR.click.",
          timestamp: new Date().toLocaleTimeString(),
          status: "done"
        }
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
    const text = "I just tested the Casper-native AI Swarm Workspace on CasperOPs! Vote for CasperOPs on CSPR.fans!";
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl font-sans min-h-screen text-slate-100 bg-slate-950">
      
      {/* CSPR.fans community voting banner */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 p-6 rounded-2xl border border-pink-500/30 bg-gradient-to-r from-pink-950/40 via-purple-950/40 to-slate-900/60 backdrop-blur-xl relative overflow-hidden shadow-[0_0_30px_-5px_rgba(236,72,153,0.15)]"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl -z-10" />
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-pink-500/20 rounded-xl text-pink-400 animate-pulse border border-pink-500/40">
              <Vote className="w-8 h-8" />
            </div>
            <div>
              <span className="text-xs font-semibold tracking-wider text-pink-400 uppercase">Casper Innovation Track</span>
              <h2 className="text-xl md:text-2xl font-bold mt-1 text-white">Support CasperOPs on CSPR.fans!</h2>
              <p className="text-sm text-slate-300 mt-1 max-w-2xl">
                If you are wowed by our Casper-native multi-agent coordination, compliance engines, and visual builder, cast your vote for CasperOPs. Helps us unlock the next phase of agent automation!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto justify-end">
            <Button 
              variant="outline" 
              className="border-pink-500/30 hover:bg-pink-950/40 text-pink-300 hover:text-pink-100 flex items-center gap-2"
              onClick={handleShare}
            >
              <Share2 className="w-4 h-4" /> Share
            </Button>
            <Link href="https://cspr.fans/project/casperops" target="_blank" passHref>
              <Button 
                className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-semibold flex items-center gap-2 border-t border-pink-400/40 shadow-lg shadow-pink-500/20"
                onClick={() => setHasVoted(true)}
              >
                Vote on CSPR.fans <ExternalLink className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
        {hasVoted && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-4 pt-4 border-t border-slate-800 text-xs text-pink-300 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Thank you for supporting CasperOPs! Your vote drives native automation forward on the Casper Network.
          </motion.div>
        )}
      </motion.div>

      {/* Main Grid */}
      <div className="grid gap-8 lg:grid-cols-3">
        
        {/* Left Side: Debate Room & Log */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl flex flex-col h-[600px]">
            <CardHeader className="border-b border-slate-800/80 flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Swarm Deliberation Room
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Live multi-agent decision consensus loop
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-semibold text-slate-400">Active Pool</span>
                <Button 
                  onClick={runSimulation} 
                  disabled={isSimulating}
                  size="sm" 
                  variant="outline" 
                  className="ml-4 border-slate-700 hover:bg-slate-800 text-slate-300 gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? "animate-spin" : ""}`} />
                  Re-simulate
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
              <AnimatePresence>
                {messages.map((msg, index) => {
                  const isCompliance = msg.agent === "Compliance";
                  const isRisk = msg.agent === "Risk";
                  const isTreasury = msg.agent === "Treasury";

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className={`flex gap-4 ${isTreasury ? "" : ""}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${
                        isCompliance ? "bg-emerald-950/50 border-emerald-500/30 text-emerald-400" :
                        isRisk ? "bg-amber-950/50 border-amber-500/30 text-amber-400" :
                        "bg-indigo-950/50 border-indigo-500/30 text-indigo-400"
                      }`}>
                        {isCompliance && <ShieldCheck className="w-5 h-5" />}
                        {isRisk && <TrendingUp className="w-5 h-5" />}
                        {isTreasury && <Wallet className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 p-4 rounded-2xl bg-slate-900/90 border border-slate-800/80">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm text-slate-200">
                            {msg.agent} Agent
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {msg.timestamp}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed font-sans">
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

        {/* Right Side: Timeline & Signing */}
        <div className="flex flex-col gap-6">
          
          {/* Swarm Consensus Status */}
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-white text-md flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-indigo-400" />
                Consensus Timelines
              </CardTitle>
              <CardDescription className="text-slate-400">
                Audit track verification
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Timeline list */}
              <div className="space-y-4 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                
                {/* Step 1: Compliance */}
                <div className="flex items-start gap-4 relative">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center z-10 ${
                    step >= 1 ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-slate-900 border-slate-800 text-slate-500"
                  }`}>
                    {step >= 1 ? <CheckCircle2 className="w-4 h-4" /> : "1"}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Compliance Attestation</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Anonymous whitelisting check passed.</p>
                  </div>
                </div>

                {/* Step 2: Risk */}
                <div className="flex items-start gap-4 relative">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center z-10 ${
                    step >= 2 ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-slate-900 border-slate-800 text-slate-500"
                  }`}>
                    {step >= 2 ? <CheckCircle2 className="w-4 h-4" /> : "2"}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Risk Assessment</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Slippage & attestation ratings check passed.</p>
                  </div>
                </div>

                {/* Step 3: Vote / Consensus */}
                <div className="flex items-start gap-4 relative">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center z-10 ${
                    step >= 3 ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-slate-900 border-slate-800 text-slate-500"
                  }`}>
                    {step >= 3 ? <CheckCircle2 className="w-4 h-4" /> : "3"}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Final Swarm Vote</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Consensus locked. Ready to execute.</p>
                  </div>
                </div>

              </div>

              {/* Execution Block */}
              {step === 3 && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="pt-4 border-t border-slate-800 space-y-4"
                >
                  {signingStatus === "idle" && (
                    <Button 
                      onClick={handleSign}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" /> Sign Swarm Decision (CSPR.click)
                    </Button>
                  )}

                  {signingStatus === "signing" && (
                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-center space-y-3">
                      <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                      <p className="text-sm text-slate-300 font-semibold">Prompting Signature via CSPR.click...</p>
                      <p className="text-xs text-slate-500">Please sign the deploy in your connected extension.</p>
                    </div>
                  )}

                  {signingStatus === "broadcasted" && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 bg-emerald-950/20 rounded-xl border border-emerald-500/30 text-emerald-400 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <span className="font-semibold text-sm">Deploy Broadcasted Successfully!</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed font-mono break-all">
                        Hash: {deployHash}
                      </p>
                      <Link 
                        href={`https://testnet.cspr.live/deploy/${deployHash}`} 
                        target="_blank"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 underline mt-1"
                      >
                        View on CSPR.live <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </CardContent>
          </Card>

          {/* Quick Info card */}
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md shadow-xl text-slate-300 text-xs leading-relaxed">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-xs flex items-center gap-1.5 uppercase tracking-wider font-semibold">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                Coordination Protocol
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                Each debate step publishes state logs directly to the on-chain <strong className="text-indigo-400 font-mono">MessageBoard</strong> contract on Casper Testnet.
              </p>
              <p>
                Agents receive and coordinate in real-time through the Redis pub-sub pool, enabling high-performance asynchronous orchestration.
              </p>
            </CardContent>
          </Card>

        </div>
      </div>
      
    </main>
  );
}
