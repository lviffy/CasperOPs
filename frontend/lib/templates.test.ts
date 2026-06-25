import { describe, it, expect } from "vitest"
import { getTemplates } from "./templates"
import { toolsToWorkflow } from "./workflow-converter"
import { createNode } from "./workflow-utils"

describe("Casper Workflow Templates Rendering", () => {
  it("should parse and map all templates successfully without generic 'Tool' fallbacks", () => {
    const templates = getTemplates()
    expect(templates.length).toBeGreaterThan(0)

    templates.forEach((template) => {
      const { nodes, edges } = toolsToWorkflow(template.tools)
      
      // All nodes in the template chain should have custom, non-fallback labels and descriptions
      nodes.forEach((node) => {
        // Exclude the Agent node itself which has type 'agent' or fallback
        if (node.id === "agent-node" || node.type === "agent") {
          return
        }

        expect(node.data.label).not.toBe("Tool")
        expect(node.data.description).not.toBe("Workflow tool")
        
        // Output mapped values for confirmation
        console.log(`Template: "${template.name}" -> Node Type: "${node.type}" -> Label: "${node.data.label}"`)
      })
    })
  })
})
