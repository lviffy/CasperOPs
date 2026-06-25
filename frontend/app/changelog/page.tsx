import Link from "next/link";

/**
 * Public changelog page (Phase 29).
 *
 * Renders docs/CHANGELOG.md as a single Markdown view. The full
 * source-of-truth lives in the markdown file (the same one that gets
 * included in the GitHub release notes); this page is a thin
 * wrapper that fetches it on the server and renders it with a
 * styled `<pre>` block.
 *
 * For v1.0 we deliberately skipped MDX — the markdown content is
 * contributor-facing, not interactive. Future versions can swap to
 * next-mdx-remote when we add embedded demos / changelog widgets.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

async function loadChangelog() {
  // Resolve from the repo root regardless of cwd (frontend dir vs
  // repo root). The file is authored at the top of the monorepo so
  // the public changelog stays in sync with the GitHub release notes.
  const candidates = [
    path.join(process.cwd(), "..", "docs", "CHANGELOG.md"),
    path.join(process.cwd(), "docs", "CHANGELOG.md"),
  ];
  for (const p of candidates) {
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      // try next
    }
  }
  return "# Changelog not available\n\nRun `git log --oneline` for the raw history.";
}

function renderMarkdown(md: string) {
  // Tiny line-by-line renderer: headings + paragraphs + lists. Enough
  // for the CHANGELOG.md shape, no need for a heavy dep.
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  for (const raw of lines) {
    const line = raw;
    if (line.startsWith("```")) {
      inCode = !inCode;
      out.push(inCode ? "<pre><code>" : "</code></pre>");
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    if (line.startsWith("### ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${formatInline(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${formatInline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function formatInline(s: string) {
  // Bold then links.
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default async function ChangelogPage() {
  const md = await loadChangelog();
  const html = renderMarkdown(md);
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Changelog</h1>
        <Link href="/" className="text-sm text-muted-foreground underline">
          ← Back to home
        </Link>
      </header>
      <article
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}