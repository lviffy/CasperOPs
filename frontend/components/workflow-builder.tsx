"use client"

import type React from "react"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import ReactFlow, {
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  Panel,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Node,
} from "reactflow"
import "reactflow/dist/style.css"
import { toast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Save, ArrowLeft, Wallet, LayoutTemplate, ChevronDown } from "lucide-react"
import NodeLibrary from "./node-library"
import NodeConfigPanel from "./node-config-panel"
import CustomEdge from "./custom-edge"
import { ToolNode } from "./nodes/tool-node"
import { AgentNode } from "./nodes/agent-node"
import { generateNodeId, createNode } from "@/lib/workflow-utils"
import type { WorkflowNode } from "@/lib/types"
import { AIChatModal } from "./ai-chat-modal"
import { UserProfile } from "./user-profile"
import { useAuth } from "@/lib/auth"
import { createAgent, getAgentById, updateAgent } from "@/lib/agents"
import { workflowToTools, toolsToWorkflow } from "@/lib/workflow-converter"
import { getTemplates, type TemplateDefinition } from "@/lib/templates"
import { AgentWalletModal } from "./agent-wallet"
import { initCsprClick, getActiveAccount } from "@/lib/wallet"
import AIQuotaCompact from "./payment/ai-quota-compact"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Casper-native tool set used by the workflow builder. Mirrors
 * `backend/services/toolRouter.js` AVAILABLE_TOOLS plus the on-chain
 * agent workflow nodes. Update both files together when adding tools.
 */
const toolTypes = [
  // Native CSPR
  "transfer",
  "batch_transfer",
  "get_balance",
  // Token / NFT deploys
  "deploy_cep18",
  "deploy_cep78",
  "mint_nft",
  "get_token_info",
  "get_token_balance",
  "get_nft_info",
  // On-chain agent registry / reputation / compliance
  "register_agent",
  "attest_agent",
  "get_reputation",
  "yield_rebalance",
  // On-chain lookups
  "lookup_deploy",
  "lookup_block",
  // Notifications / utilities
  "fetch_price",
  "send_email",
  "wallet_readiness",
]

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  transfer: ToolNode,
  batch_transfer: ToolNode,
  get_balance: ToolNode,
  deploy_cep18: ToolNode,
  deploy_cep78: ToolNode,
  mint_nft: ToolNode,
  get_token_info: ToolNode,
  get_token_balance: ToolNode,
  get_nft_info: ToolNode,
  register_agent: ToolNode,
  attest_agent: ToolNode,
  get_reputation: ToolNode,
  yield_rebalance: ToolNode,
  lookup_deploy: ToolNode,
  lookup_block: ToolNode,
  fetch_price: ToolNode,
  send_email: ToolNode,
  wallet_readiness: ToolNode,
}

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
}

interface WorkflowBuilderProps {
  agentId?: string
}

const AGENT_NODE_ID = "agent-node"

const createAgentNode = (): Node => ({
  id: AGENT_NODE_ID,
  type: "agent",
  position: { x: 100, y: 100 },
  data: {
    label: "Agent",
    description: "Your Casper agent",
    config: {},
  },
  draggable: true,
  selectable: true,
  deletable: false,
})

export default function WorkflowBuilder({ agentId }: WorkflowBuilderProps) {
  const router = useRouter()
  const { user, authenticated, logout, dbUser } = useAuth()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([createAgentNode()])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [agentName, setAgentName] = useState("")
  const [agentDescription, setAgentDescription] = useState("")
  const [loadingAgent, setLoadingAgent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNodeLibrary, setShowNodeLibrary] = useState(false)
  const [walletBalance, setWalletBalance] = useState<string | null>(null)
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const templateMenuRef = useRef<HTMLDivElement>(null)

  const loadTemplate = useCallback(
    (template: TemplateDefinition) => {
      const { nodes: templateNodes, edges: templateEdges } = toolsToWorkflow(template.tools, AGENT_NODE_ID)
      const agentNode = createAgentNode()
      setNodes([agentNode, ...templateNodes])
      setEdges(templateEdges)
      setTemplateLoaded(true)
      setShowTemplateMenu(false)
      setTimeout(() => reactFlowInstance?.fitView({ padding: 0.2 }), 100)
      toast({
        title: `Loaded: ${template.name}`,
        description: template.description,
      })
    },
    [setNodes, setEdges, reactFlowInstance],
  )

  // Close template menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Pre-load Yield Optimizer template on first visit (no agentId, no existing workflow)
  useEffect(() => {
    if (!agentId && !templateLoaded && reactFlowInstance) {
      const templates = getTemplates()
      if (templates.length > 0) {
        loadTemplate(templates[0])
      }
    }
  }, [agentId, templateLoaded, reactFlowInstance, loadTemplate])

  // Initialize CSPR.click once on mount
  useEffect(() => {
    initCsprClick()
    // Try to refresh the active account balance for the header chip
    if (dbUser?.wallet_address) {
      getActiveAccount()
        .then((acc) => {
          if (acc?.balance) setWalletBalance(acc.balance)
        })
        .catch(() => {})
    }
  }, [dbUser?.wallet_address])

  const handleNodesChange = useCallback(
    (changes: any[]) => {
      const filteredChanges = changes.filter((change) => {
        if (change.type === "remove" && change.id === AGENT_NODE_ID) return false
        return true
      })
      onNodesChange(filteredChanges)
      setNodes((nds) => {
        const hasAgentNode = nds.some((node) => node.id === AGENT_NODE_ID)
        if (!hasAgentNode) return [...nds, createAgentNode()]
        return nds
      })
    },
    [onNodesChange, setNodes],
  )

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge({ ...params, type: "custom" }, eds)),
    [setEdges],
  )

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect()
      const type = event.dataTransfer.getData("application/reactflow")
      if (typeof type === "undefined" || !type || !toolTypes.includes(type)) return

      if (reactFlowBounds && reactFlowInstance) {
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })
        const newNode = createNode({ type, position, id: generateNodeId(type) })

        setNodes((nds) => {
          const updatedNodes = nds.concat(newNode)
          setEdges((eds) => {
            const hasIncoming = eds.some((edge) => edge.target === newNode.id)
            if (!hasIncoming) {
              const agentEdge: Edge = {
                id: `edge-${AGENT_NODE_ID}-${newNode.id}`,
                source: AGENT_NODE_ID,
                target: newNode.id,
                type: "custom",
              }
              return [...eds, agentEdge]
            }
            return eds
          })
          return updatedNodes
        })
      }
    },
    [reactFlowInstance, setNodes, setEdges],
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const updateNodeData = useCallback(
    (nodeId: string, data: any) => {
      setNodes((nds) =>
        nds.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node)),
      )
    },
    [setNodes],
  )

  const handleSaveClick = () => {
    const toolNodes = nodes.filter((node) => node.id !== AGENT_NODE_ID)
    if (toolNodes.length === 0) {
      toast({ title: "Nothing to save", description: "Add some tools to your workflow first", variant: "destructive" })
      return
    }
    if (!authenticated || !user?.id) {
      toast({ title: "Not authenticated", description: "Please log in to save your workflow", variant: "destructive" })
      return
    }
    setShowSaveDialog(true)
  }

  const saveWorkflow = async () => {
    if (!agentName.trim()) {
      toast({ title: "Agent name required", description: "Please enter a name for your agent", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      const tools = workflowToTools(nodes, edges, AGENT_NODE_ID)
      if (agentId) {
        await updateAgent(agentId, { name: agentName, description: agentDescription || null, tools })
        toast({ title: "Agent updated", description: "Your agent has been updated successfully" })
      } else {
        if (!user?.id) {
          toast({ title: "Error", description: "User not authenticated", variant: "destructive" })
          return
        }
        await createAgent(user.id, agentName, agentDescription || null, tools)
        toast({ title: "Agent created", description: "Your agent has been created successfully" })
      }
      setShowSaveDialog(false)
      router.push("/my-agents")
    } catch (error: any) {
      console.error("Error saving agent:", error)
      toast({ title: "Error saving agent", description: error.message || "Failed to save agent", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleBackClick = () => {
    const toolNodes = nodes.filter((node) => node.id !== AGENT_NODE_ID)
    const toolEdges = edges.filter((edge) => edge.source !== AGENT_NODE_ID && edge.target !== AGENT_NODE_ID)
    if (toolNodes.length > 0 || toolEdges.length > 0) {
      setShowExitDialog(true)
    } else {
      router.push("/my-agents")
    }
  }

  const handleConfirmExit = () => {
    setShowExitDialog(false)
    router.push("/my-agents")
  }

  useEffect(() => {
    if (agentId && authenticated && user?.id) {
      setTemplateLoaded(true)
      loadAgent()
    }
  }, [agentId, authenticated, user])

  const loadAgent = async () => {
    if (!agentId) return
    setLoadingAgent(true)
    try {
      const agent = await getAgentById(agentId)
      if (agent) {
        if (agent.user_id !== user?.id) {
          toast({ title: "Access denied", description: "You don't have permission to access this agent", variant: "destructive" })
          router.push("/my-agents")
          return
        }
        setAgentName(agent.name)
        setAgentDescription(agent.description || "")
        if (agent.tools && agent.tools.length > 0) {
          const { nodes: loadedNodes, edges: loadedEdges } = toolsToWorkflow(agent.tools, AGENT_NODE_ID)
          setNodes([createAgentNode(), ...loadedNodes])
          setEdges(loadedEdges)
          setTimeout(() => reactFlowInstance?.fitView({ padding: 0.2 }), 100)
        } else {
          setNodes([createAgentNode()])
          setEdges([])
        }
      }
    } catch (error) {
      console.error("Error loading agent:", error)
      toast({ title: "Error loading agent", description: "Failed to load agent data", variant: "destructive" })
    } finally {
      setLoadingAgent(false)
    }
  }

  return (
    <div className="flex h-screen relative">
      <div className="hidden md:flex w-64 border-r border-gray-200 flex-col bg-gray-50">
        <div className="flex-1 p-4 overflow-y-auto">
          <NodeLibrary />
        </div>
        <div className="border-t border-gray-200 p-3">
          <AIQuotaCompact />
        </div>
      </div>

      {showNodeLibrary && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNodeLibrary(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-lg">Node Library</h3>
              <button onClick={() => setShowNodeLibrary(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <NodeLibrary />
            </div>
            <div className="border-t border-gray-200 p-3">
              <AIQuotaCompact />
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col">
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              snapToGrid
              snapGrid={[15, 15]}
              defaultEdgeOptions={{ type: "custom" }}
            >
              <Background />
              <Controls />
              <MiniMap className="hidden sm:block" />
              <Panel position="top-left">
                <div className="flex gap-2">
                  <Button onClick={handleBackClick} size="sm" variant="outline" className="font-medium">
                    <ArrowLeft className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Back</span>
                  </Button>
                  <div className="relative" ref={templateMenuRef}>
                    <Button
                      onClick={() => setShowTemplateMenu((v) => !v)}
                      size="sm"
                      variant="outline"
                      className="font-medium text-xs sm:text-sm"
                    >
                      <LayoutTemplate className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Templates</span>
                      <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${showTemplateMenu ? "rotate-180" : ""}`} />
                    </Button>
                    {showTemplateMenu && (
                      <div className="absolute left-0 top-full mt-1 w-72 bg-white rounded-lg border border-gray-200 shadow-xl z-50">
                        <div className="p-2 space-y-1">
                          {getTemplates().map((template) => (
                            <button
                              key={template.name}
                              onClick={() => loadTemplate(template)}
                              className="w-full text-left px-3 py-2.5 rounded hover:bg-gray-50 transition-colors"
                            >
                              <div className="text-sm font-medium text-gray-900">{template.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{template.description}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => setIsAIChatOpen(true)}
                    size="sm"
                    variant="default"
                    className="bg-foreground text-background hover:bg-foreground/90 shadow-lg font-semibold text-xs sm:text-sm"
                  >
                    <LayoutTemplate className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Create with AI</span>
                    <span className="sm:hidden">AI</span>
                  </Button>
                  <Button
                    onClick={() => setShowNodeLibrary(true)}
                    size="sm"
                    variant="outline"
                    className="md:hidden font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </Button>
                </div>
              </Panel>
              <Panel position="top-right">
                <div className="flex gap-2 items-center">
                  {dbUser?.wallet_address ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowWalletModal(true)}
                      className="font-medium text-xs sm:text-sm"
                    >
                      <Wallet className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">
                        {walletBalance ? `${walletBalance} CSPR` : "Wallet"}
                      </span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowWalletModal(true)}
                      className="font-medium text-xs sm:text-sm"
                    >
                      <Wallet className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Connect Wallet</span>
                    </Button>
                  )}
                  <Button onClick={handleSaveClick} size="sm" variant="outline" disabled={loadingAgent} className="text-xs sm:text-sm">
                    <Save className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{agentId ? "Update Agent" : "Save Agent"}</span>
                  </Button>
                  <UserProfile onLogout={() => { logout(); router.push("/") }} />
                </div>
              </Panel>
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>

      {selectedNode && selectedNode.id !== AGENT_NODE_ID && (
        <>
          <div className="md:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedNode(null)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto">
              <NodeConfigPanel
                node={selectedNode as WorkflowNode}
                updateNodeData={updateNodeData}
                onClose={() => setSelectedNode(null)}
              />
            </div>
          </div>
          <div className="hidden md:block w-80 border-l border-gray-200 p-4 bg-gray-50">
            <NodeConfigPanel
              node={selectedNode as WorkflowNode}
              updateNodeData={updateNodeData}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        </>
      )}

      <AgentWalletModal open={showWalletModal} onOpenChange={setShowWalletModal} />

      <AIChatModal
        open={isAIChatOpen}
        onOpenChange={setIsAIChatOpen}
        onApplyWorkflow={(aiNodes, aiEdges) => {
          const agentNode = createAgentNode()
          const allNodes = [agentNode, ...aiNodes]
          const nodesWithIncoming = new Set<string>()
          aiEdges.forEach((edge) => nodesWithIncoming.add(edge.target))
          const agentEdges: Edge[] = aiNodes
            .filter((node) => !nodesWithIncoming.has(node.id))
            .map((node) => ({
              id: `edge-${AGENT_NODE_ID}-${node.id}`,
              source: AGENT_NODE_ID,
              target: node.id,
              type: "custom" as const,
            }))
          setNodes(allNodes)
          setEdges([...agentEdges, ...aiEdges])
          setTimeout(() => reactFlowInstance?.fitView({ padding: 0.2 }), 100)
          toast({ title: "Workflow applied", description: "AI-generated workflow has been applied to the canvas" })
        }}
      />

      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Agent Builder?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in your workflow. If you leave now, all your progress will be lost. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExit} className="bg-foreground text-background hover:bg-foreground/90">
              Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <DialogHeader>
            <DialogTitle>{agentId ? "Update Agent" : "Create Agent"}</DialogTitle>
            <DialogDescription>
              Enter the name and description for your agent. The workflow will be saved with all configured Casper tools.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent Name *</Label>
              <Input
                id="agent-name"
                placeholder="My Casper Agent"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-description">Description (optional)</Label>
              <Textarea
                id="agent-description"
                placeholder="Describe what this agent does..."
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Tools to be saved</Label>
              <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(workflowToTools(nodes, edges, AGENT_NODE_ID), null, 2)}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">
                This tools array is what the backend AI router will execute on Casper Testnet.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveWorkflow} disabled={saving || !agentName.trim()}>
              {saving ? "Saving..." : agentId ? "Update Agent" : "Create Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
