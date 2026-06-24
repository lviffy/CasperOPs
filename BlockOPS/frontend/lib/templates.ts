export interface TemplateDefinition {
  name: string
  description: string
  icon: string
  tools: Array<{ tool: string; next_tool: string | null }>
}

import yieldOptimizer from "@/templates/yield-optimizer.json"
import rwaVerifier from "@/templates/rwa-verifier.json"
import complianceGuardian from "@/templates/compliance-guardian.json"
import daoTreasury from "@/templates/dao-treasury.json"
import rwaYieldFund from "@/templates/rwa-yield-fund.json"
import daoArbitrage from "@/templates/dao-arbitrage.json"

const TEMPLATES: TemplateDefinition[] = [
  yieldOptimizer as TemplateDefinition,
  rwaVerifier as TemplateDefinition,
  complianceGuardian as TemplateDefinition,
  daoTreasury as TemplateDefinition,
  rwaYieldFund as TemplateDefinition,
  daoArbitrage as TemplateDefinition,
]

export function getTemplates(): TemplateDefinition[] {
  return TEMPLATES
}

export function getTemplateByName(name: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.name === name)
}

export function getTemplateByIndex(index: number): TemplateDefinition | undefined {
  return TEMPLATES[index]
}

export const DEFAULT_TEMPLATE_NAME = "Yield Optimizer"
