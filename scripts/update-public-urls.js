import fs from "fs";
import path from "path";

const docPath = path.join(process.cwd(), "docs/dorahacks-submission.md");

const diagrams = {
  system_architecture: `graph TD
    A[Browser / CSPR.click / x402 Client] -->|HTTP 402 Challenge / Response| B[Express Backend API]
    B -->|RPC / CSPR.cloud| C[Casper Testnet]
    C -->|State Queries| B
    
    D[External AI: LangGraph / CrewAI] -->|MCP stdio / SSE| E[Python MCP Server]
    E -->|Write Proxies / Tools| B
    
    subgraph On-Chain State Enforcement - Odra Contracts
        C --> AF[AgentFactory]
        C --> R[Reputation]
        C --> ES[Escrow]
        C --> CO[Compliance]
    end`,

  escrow_lifecycle: `stateDiagram-v2
    [*] --> Idle
    Idle --> Deposited : User calls Escrow.deposit() (locks CSPR)
    Deposited --> Active : Budget Locked in Escrow
    Active --> SuccessState : Agent completes task successfully
    Active --> FailureState : Agent fails task / error occurs
    SuccessState --> Released : Backend calls execute_payout()
    FailureState --> Refunded : Backend calls refund()
    Released --> [*] : Funds transferred to Developer
    Refunded --> [*] : Funds returned to User`,

  x402_sequence: `sequenceDiagram
    autonumber
    actor Client as Client / Browser (CSPR.click)
    participant Backend as Express Backend (x402)
    participant RPC as Casper Testnet Node
    
    Client->>Backend: POST /api/v1/tools/mint_cep78 (No Payment Header)
    Backend-->>Client: HTTP 402 Payment Required (JSON Deploy Template)
    Client->>Client: Sign Deploy Payload via CSPR.click
    Client->>RPC: broadcast_deploy(Signed CSPR Transfer Deploy)
    RPC-->>Client: Returns Deploy Hash
    Client->>Backend: Retry POST /api/v1/tools/mint_cep78 (With Deploy Hash & Payer Public Key)
    Backend->>RPC: info_get_deploy(Deploy Hash)
    RPC-->>Backend: Return Deploy Status & Execution Results
    Backend->>Backend: Verify Signer, Recipient, Amount & Block Success
    Backend->>RPC: Execute tool (mint_cep78)
    Backend-->>Client: HTTP 200 OK (NFT Minted)`,

  mcp_integration: `graph LR
    subgraph External AI Framework
        LG[LangGraph / CrewAI Agent]
    end
    subgraph Model Context Protocol
        MCP[FastAPI MCP Server]
        Disp[Unified Tool Dispatcher]
    end
    subgraph Execution Layer
        Local[Local Formatters]
        RPC[Read-only RPC / CSPR.cloud]
        Proxy[Paid Write Proxy via Backend]
    end

    LG -->|JSON-RPC via stdio/SSE| MCP
    MCP --> Disp
    Disp -->|Local Schema| Local
    Disp -->|Balance / State Query| RPC
    Disp -->|Token Deploy / Mint| Proxy`
};

function updateMarkdownWithPublicUrls() {
  let content = fs.readFileSync(docPath, "utf8");

  for (const [name, code] of Object.entries(diagrams)) {
    const base64Code = Buffer.from(code.trim()).toString("base64url");
    const publicUrl = `https://mermaid.ink/img/${base64Code}`;
    
    // Find the local image reference and replace it with the public URL
    const localRef = `![${name.replace(/_/g, " ")}](images/${name}.png)`;
    content = content.replace(localRef, `![${name.replace(/_/g, " ")}](${publicUrl})`);
  }

  fs.writeFileSync(docPath, content, "utf8");
  console.log("Successfully updated dorahacks-submission.md with public web-accessible PNG URLs!");
}

updateMarkdownWithPublicUrls();
