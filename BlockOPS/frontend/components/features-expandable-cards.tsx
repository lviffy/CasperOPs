"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { Workflow, Wallet, Shield, Sparkles, Activity, Network } from "lucide-react";

export default function FeaturesExpandableCards() {
  const [active, setActive] = useState<(typeof cards)[number] | boolean | null>(
    null
  );
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActive(false);
      }
    }

    if (active && typeof active === "object") {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  useOutsideClick(ref, () => setActive(null));

  return (
    <>
      <AnimatePresence>
        {active && typeof active === "object" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 h-full w-full z-10"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {active && typeof active === "object" ? (
          <div className="fixed inset-0 grid place-items-center z-[100]">
            <motion.button
              key={`button-${active.title}-${id}`}
              layout
              initial={{
                opacity: 0,
              }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
                transition: {
                  duration: 0.05,
                },
              }}
              className="flex absolute top-2 right-2 lg:hidden items-center justify-center bg-white rounded-full h-6 w-6"
              onClick={() => setActive(null)}
            >
              <CloseIcon />
            </motion.button>
            <motion.div
              layoutId={`card-${active.title}-${id}`}
              ref={ref}
              className="w-full max-w-[500px] h-full md:h-fit md:max-h-[90%] flex flex-col bg-white dark:bg-neutral-900 sm:rounded-xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <motion.div
                    layoutId={`icon-${active.title}-${id}`}
                    className="w-16 h-16 bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0"
                  >
                    {active.icon}
                  </motion.div>
                  <div>
                    <motion.h3
                      layoutId={`title-${active.title}-${id}`}
                      className="font-bold text-2xl text-slate-900"
                    >
                      {active.title}
                    </motion.h3>
                    <motion.p
                      layoutId={`description-${active.description}-${id}`}
                      className="text-slate-600"
                    >
                      {active.description}
                    </motion.p>
                  </div>
                </div>

                <div className="relative">
                  <motion.div
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-slate-600 text-sm leading-relaxed space-y-4 max-h-[60vh] overflow-auto pr-2"
                  >
                    {typeof active.content === "function"
                      ? active.content()
                      : active.content}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {cards.map((card) => (
          <motion.div
            layoutId={`card-${card.title}-${id}`}
            key={`card-${card.title}-${id}`}
            onClick={() => setActive(card)}
            className="group relative bg-white p-6 sm:p-8 lg:p-10 rounded-xl border border-slate-200 cursor-pointer"
          >
            <div className="relative z-10">
              <motion.div
                layoutId={`icon-${card.title}-${id}`}
                className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-slate-900 rounded-lg flex items-center justify-center mb-4 sm:mb-6 lg:mb-8"
              >
                {card.icon}
              </motion.div>
              <motion.h3
                layoutId={`title-${card.title}-${id}`}
                className="text-lg sm:text-xl font-bold text-slate-900 mb-2 sm:mb-3"
              >
                {card.title}
              </motion.h3>
              <motion.p
                layoutId={`description-${card.description}-${id}`}
                className="text-slate-600 text-sm sm:text-base leading-relaxed"
              >
                {card.description}
              </motion.p>
            </div>
          </motion.div>
        ))}
      </div>
    </>
  );
}

export const CloseIcon = () => {
  return (
    <motion.svg
      initial={{
        opacity: 0,
      }}
      animate={{
        opacity: 1,
      }}
      exit={{
        opacity: 0,
        transition: {
          duration: 0.05,
        },
      }}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-black"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </motion.svg>
  );
};

const cards = [
  {
    title: "Visual Workflow Builder",
    description: "Drag-and-drop interface for complex automation",
    icon: <Workflow className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Our Visual Workflow Builder revolutionizes how you create blockchain automation. With an intuitive drag-and-drop interface, you can design complex workflows without writing a single line of code.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Key Features:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Pre-built templates for common blockchain operations</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Real-time validation and error checking</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Custom node creation for specialized tasks</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Version control and workflow history</span>
              </li>
            </ul>
          </div>
          <p>
            Perfect for both beginners and advanced users, the builder adapts to your skill level and project complexity.
          </p>
        </div>
      );
    },
  },
  {
    title: "Secure Wallet Integration",
    description: "Connect Web3 wallets and execute transactions",
    icon: <Wallet className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Connect your Web3 wallet securely with enterprise-grade encryption. Execute transactions directly from your agents with full control and transparency.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Security Features:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Hardware wallet support (Ledger, Trezor)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Multi-signature transaction support</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Transaction simulation before execution</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Automated gas optimization</span>
              </li>
            </ul>
          </div>
          <p>
            Your private keys never leave your device. All transactions are signed locally with your explicit approval.
          </p>
        </div>
      );
    },
  },
  {
    title: "Smart Contract Explorer",
    description: "Test and interact with any smart contract",
    icon: <Shield className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Explore and interact with any smart contract on supported networks. Test functions, read state, and execute transactions all from one intuitive interface.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Explorer Capabilities:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Automatic ABI fetching from block explorers</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Function parameter type conversion</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Read and write function categorization</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Transaction history and analytics</span>
              </li>
            </ul>
          </div>
          <p>
            Perfect for developers, auditors, and anyone working with smart contracts on a daily basis.
          </p>
        </div>
      );
    },
  },
  {
    title: "AI-Powered Assistance",
    description: "Intelligent suggestions for blockchain interactions",
    icon: <Sparkles className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Leverage cutting-edge AI to automate complex blockchain interactions. Get intelligent suggestions, optimize your workflows, and reduce errors with machine learning-powered assistance.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">AI Features:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Natural language to workflow conversion</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Smart contract interaction suggestions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Anomaly detection and security alerts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Workflow optimization recommendations</span>
              </li>
            </ul>
          </div>
          <p>
            Our AI continuously learns from the blockchain ecosystem to provide you with the most relevant and up-to-date assistance.
          </p>
        </div>
      );
    },
  },
  {
    title: "Real-time Monitoring",
    description: "Track performance with instant notifications",
    icon: <Activity className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Monitor your agents' performance in real-time with comprehensive analytics and instant notifications. Never miss an important event or transaction.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Monitoring Tools:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Real-time dashboard with live updates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Custom alerts and notifications</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Performance metrics and analytics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Error tracking and debugging tools</span>
              </li>
            </ul>
          </div>
          <p>
            Stay informed with email, SMS, or webhook notifications for critical events and agent status changes.
          </p>
        </div>
      );
    },
  },
  {
    title: "Multi-Chain Support",
    description: "Deploy agents across multiple blockchains",
    icon: <Network className="w-7 h-7 text-white" />,
    content: () => {
      return (
        <div className="space-y-4">
          <p>
            Deploy your agents across multiple blockchain networks with seamless integration. Support for all major EVM-compatible chains and beyond.
          </p>
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-2">Supported Networks:</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Ethereum, Polygon, Arbitrum, Optimism</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>BSC, Avalanche, Fantom, Cronos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Custom RPC endpoint support</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-slate-900">•</span>
                <span>Cross-chain transaction orchestration</span>
              </li>
            </ul>
          </div>
          <p>
            One workflow, multiple chains. Deploy once and manage your agents across all networks from a single dashboard.
          </p>
        </div>
      );
    },
  },
];
