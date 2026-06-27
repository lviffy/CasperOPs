import fs from "fs";
import path from "path";

const docPath = path.join(process.cwd(), "docs/dorahacks-submission.md");
const imgDir = path.join(process.cwd(), "docs/images");

if (!fs.existsSync(imgDir)) {
  fs.mkdirSync(imgDir, { recursive: true });
}

async function renderDiagrams() {
  let content = fs.readFileSync(docPath, "utf8");
  
  // Regex to match mermaid blocks
  const mermaidRegex = /```mermaid\s*([\s\S]*?)\n```/g;
  let match;
  let index = 1;
  
  const names = [
    "system_architecture",
    "escrow_lifecycle",
    "x402_sequence",
    "mcp_integration"
  ];

  const matches = [...content.matchAll(mermaidRegex)];
  
  for (let i = 0; i < matches.length; i++) {
    const fullMatch = matches[i][0];
    const code = matches[i][1].trim();
    const name = names[i] || `diagram_${index++}`;
    const imgPath = path.join(imgDir, `${name}.png`);
    
    console.log(`Rendering ${name}...`);
    
    // Base64 encode the mermaid code
    const base64Code = Buffer.from(code).toString("base64url");
    const url = `https://mermaid.ink/img/${base64Code}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.statusText}`);
      }
      const buffer = await res.arrayBuffer();
      fs.writeFileSync(imgPath, Buffer.from(buffer));
      console.log(`Saved ${name}.png`);
      
      // Replace in markdown
      content = content.replace(fullMatch, `![${name.replace(/_/g, " ")}](images/${name}.png)`);
    } catch (err) {
      console.error(`Error rendering ${name}:`, err.message);
    }
  }
  
  fs.writeFileSync(docPath, content, "utf8");
  console.log("Updated dorahacks-submission.md with PNG references!");
}

renderDiagrams();
