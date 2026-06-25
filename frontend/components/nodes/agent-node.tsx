"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import { Bot } from "lucide-react"
import type { NodeData } from "@/lib/types"

export const AgentNode = memo(({ data, isConnectable }: NodeProps<NodeData>) => {
  return (
    <div className="shadow-md rounded-md w-[120px] h-[120px] border border-gray-400 bg-background flex flex-col items-center justify-center gap-2">
      <Bot className="h-8 w-8 text-foreground" />
      <div className="text-sm font-bold text-foreground">Agent</div>
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="w-3 h-3" />
    </div>
  )
})

AgentNode.displayName = "AgentNode"

