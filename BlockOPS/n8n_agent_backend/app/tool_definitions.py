from .config import BACKEND_URL

# Casper-native Tool Definitions for the BlockOps AI Agent
TOOL_DEFINITIONS = {
    # ── CSPR Transfers ────────────────────────────────────────────────
    "transfer": {
        "name": "transfer",
        "description": (
            "Transfer native CSPR tokens from one Casper account to another. "
            "Requires fromAddress (public key), toAddress (public key), and amount in CSPR."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fromAddress": {"type": "string", "description": "Sender Casper public key (01... or 02...)"},
                "toAddress":   {"type": "string", "description": "Recipient Casper public key"},
                "amount":      {"type": "string", "description": "Amount of CSPR to transfer (e.g. '10')"},
                "privateKey":  {"type": "string", "description": "Sender private key (hex)"},
            },
            "required": ["fromAddress", "toAddress", "amount"],
        },
        "endpoint": f"{BACKEND_URL}/transfer/prepare",
        "method": "POST",
    },

    "get_balance": {
        "name": "get_balance",
        "description": "Get the native CSPR balance of a Casper wallet address.",
        "parameters": {
            "type": "object",
            "properties": {
                "address": {"type": "string", "description": "Casper public key to check balance for"},
            },
            "required": ["address"],
        },
        "endpoint": f"{BACKEND_URL}/transfer/balance/{{address}}",
        "method": "GET",
    },

    # ── CEP-18 Token (Casper Fungible Token Standard) ─────────────────
    "deploy_cep18": {
        "name": "deploy_cep18",
        "description": (
            "Deploy a new CEP-18 fungible token (Casper's ERC-20 equivalent) on Casper Testnet. "
            "Returns a deploy hash. Requires privateKey, name, symbol, initialSupply. Optional: decimals (default 9)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "privateKey":    {"type": "string", "description": "Deployer private key (hex)"},
                "name":          {"type": "string", "description": "Token name (e.g. 'MyToken')"},
                "symbol":        {"type": "string", "description": "Token symbol (e.g. 'MTK')"},
                "initialSupply": {"type": "string", "description": "Total token supply"},
                "decimals":      {"type": "number", "description": "Token decimals (optional, default 9)"},
            },
            "required": ["privateKey", "name", "symbol", "initialSupply"],
        },
        "endpoint": f"{BACKEND_URL}/token/deploy",
        "method": "POST",
    },

    # ── CEP-78 NFT (Casper NFT Standard) ──────────────────────────────
    "deploy_cep78": {
        "name": "deploy_cep78",
        "description": (
            "Deploy a new CEP-78 NFT collection (Casper's ERC-721 equivalent) on Casper Testnet. "
            "Requires privateKey, name, and symbol."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "privateKey": {"type": "string", "description": "Deployer private key (hex)"},
                "name":       {"type": "string", "description": "Collection name"},
                "symbol":     {"type": "string", "description": "Collection symbol"},
                "baseURI":    {"type": "string", "description": "Base URI for token metadata (optional, e.g. ipfs://...)"},
            },
            "required": ["privateKey", "name", "symbol"],
        },
        "endpoint": f"{BACKEND_URL}/nft/deploy-collection",
        "method": "POST",
    },

    "mint_nft": {
        "name": "mint_nft",
        "description": "Mint a new NFT into an existing CEP-78 collection. Requires privateKey, collectionAddress (contract hash), and toAddress.",
        "parameters": {
            "type": "object",
            "properties": {
                "privateKey":        {"type": "string", "description": "Creator private key (hex)"},
                "collectionAddress": {"type": "string", "description": "CEP-78 contract hash (hex, no '0x')"},
                "toAddress":         {"type": "string", "description": "Recipient Casper public key"},
            },
            "required": ["privateKey", "collectionAddress", "toAddress"],
        },
        "endpoint": f"{BACKEND_URL}/nft/mint",
        "method": "POST",
    },

    # ── Casper Agent Registry (Odra contracts) ────────────────────────
    "register_agent": {
        "name": "register_agent",
        "description": (
            "Register an agent address on the Casper AgentFactory smart contract. "
            "Records the deployer as the owner of the given agent address."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "privateKey":    {"type": "string", "description": "Owner private key (hex)"},
                "agentAddress":  {"type": "string", "description": "Casper public key address to register as the agent"},
            },
            "required": ["privateKey", "agentAddress"],
        },
        "endpoint": f"{BACKEND_URL}/agent/register",
        "method": "POST",
    },

    "get_reputation": {
        "name": "get_reputation",
        "description": "Fetch the on-chain reputation rating and execution stats for a given agent address from the Reputation contract.",
        "parameters": {
            "type": "object",
            "properties": {
                "agentAddress": {"type": "string", "description": "Casper public key of the agent"},
            },
            "required": ["agentAddress"],
        },
        "endpoint": f"{BACKEND_URL}/agent/reputation/{{agentAddress}}",
        "method": "GET",
    },

    "attest_agent": {
        "name": "attest_agent",
        "description": (
            "Submit a Real World Asset (RWA) compliance attestation for an agent via the Compliance contract. "
            "Records a policy rule on-chain."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "privateKey":   {"type": "string", "description": "Validator private key (hex)"},
                "agentAddress": {"type": "string", "description": "Agent's Casper public key to attest"},
                "policyId":     {"type": "string", "description": "Compliance policy identifier"},
            },
            "required": ["privateKey", "agentAddress", "policyId"],
        },
        "endpoint": f"{BACKEND_URL}/agent/attest",
        "method": "POST",
    },

    # ── On-chain Lookups ──────────────────────────────────────────────
    "lookup_deploy": {
        "name": "lookup_deploy",
        "description": "Look up the execution status of a Casper deploy by its deploy hash.",
        "parameters": {
            "type": "object",
            "properties": {
                "deployHash": {"type": "string", "description": "64-character hex deploy hash"},
            },
            "required": ["deployHash"],
        },
        "endpoint": f"{BACKEND_URL}/transfer/deploy/{{deployHash}}",
        "method": "GET",
    },

    "get_token_info": {
        "name": "get_token_info",
        "description": "Get metadata (name, symbol, decimals, supply) of a deployed CEP-18 token contract.",
        "parameters": {
            "type": "object",
            "properties": {
                "tokenId": {"type": "string", "description": "CEP-18 contract hash"},
            },
            "required": ["tokenId"],
        },
        "endpoint": f"{BACKEND_URL}/token/info/{{tokenId}}",
        "method": "GET",
    },

    "get_nft_info": {
        "name": "get_nft_info",
        "description": "Get metadata for a specific token in a CEP-78 NFT collection.",
        "parameters": {
            "type": "object",
            "properties": {
                "collectionAddress": {"type": "string", "description": "CEP-78 collection contract hash"},
                "tokenId":           {"type": "string", "description": "Numeric token ID within the collection"},
            },
            "required": ["collectionAddress", "tokenId"],
        },
        "endpoint": f"{BACKEND_URL}/nft/info/{{collectionAddress}}/{{tokenId}}",
        "method": "GET",
    },

    # ── Utilities ─────────────────────────────────────────────────────
    "fetch_price": {
        "name": "fetch_price",
        "description": "Fetch the current live price of CSPR or another cryptocurrency from CSPR.cloud / CoinGecko.",
        "parameters": {
            "type": "object",
            "properties": {
                "query":      {"type": "string", "description": "Coin query (e.g. 'cspr', 'bitcoin', 'ethereum')"},
                "vsCurrency": {"type": "string", "description": "Target fiat currency (default 'usd')"},
            },
            "required": ["query"],
        },
        "endpoint": f"{BACKEND_URL}/price/token",
        "method": "POST",
    },

    "send_email": {
        "name": "send_email",
        "description": "Send an email notification to one or more recipients via Gmail SMTP.",
        "parameters": {
            "type": "object",
            "properties": {
                "to":      {"type": "string", "description": "Recipient email address(es), comma-separated"},
                "subject": {"type": "string", "description": "Email subject"},
                "text":    {"type": "string", "description": "Plain text body"},
                "html":    {"type": "string", "description": "HTML body (optional)"},
            },
            "required": ["to", "subject", "text"],
        },
        "endpoint": f"{BACKEND_URL}/email/send",
        "method": "POST",
    },

    "calculate": {
        "name": "calculate",
        "description": (
            "Evaluate a math expression with named variables. "
            "Useful for computing CSPR amounts, token quantities, or fee estimates. "
            "Variable names in the expression MUST exactly match keys in the 'variables' dict."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "Math expression using variable names, e.g. 'cspr_balance * cspr_price'"},
                "variables":  {"type": "object", "description": "Dict of variable names to numeric values, e.g. {'cspr_balance': 100, 'cspr_price': 0.07}"},
                "description": {"type": "string", "description": "Brief description of what is being calculated"},
            },
            "required": ["expression"],
        },
        "endpoint": "local",
        "method": "LOCAL",
    },
}
