"use client"

import type React from "react"

import { useCallback } from "react"
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath, useReactFlow } from "reactflow"

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const { setEdges } = useReactFlow()

  const onEdgeClick = useCallback(
    (evt: React.MouseEvent<SVGGElement, MouseEvent>, id: string) => {
      evt.stopPropagation()
      setEdges((edges) => edges.filter((edge) => edge.id !== id))
    },
    [setEdges],
  )

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {data?.label && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan bg-card text-card-foreground border border-border rounded px-2 py-1 text-xs font-medium"
          >
            {data.label}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
