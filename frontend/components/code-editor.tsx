"use client"
import { Textarea } from "@/components/ui/textarea"

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: string
}

export default function CodeEditor({ value, onChange, language = "javascript" }: CodeEditorProps) {
  // In a real implementation, you would use a proper code editor like Monaco Editor
  // For this MVP, we'll use a simple textarea with some basic styling
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono text-sm h-64 whitespace-pre"
      spellCheck={false}
    />
  )
}
