1. Sequential Execution (Airdrop → Yield Deposit)
{
  "tools": [
    {"tool": "airdrop", "next_tool": "deposit_yield"},
    {"tool": "get_balance", "next_tool": null}
  ],
  "user_message": "Airdrop 0.05 tokens to 0x5732e1bccaeb161e3b93d126010042b0f1b9cfc9, 0x5309c8d6305ff451dd833fe8b0f249e942899933 then deposit 0.1 tokens at 5% APY",
  "private_key": "0x7a425200e31e8409c27abbc9aaae49a94c314426ef2e569d3a33ffc289a34e76"
}

2. Multiple Independent Tools
{
  "tools": [
    {"tool": "get_balance", "next_tool": null},
    {"tool": "fetch_price", "next_tool": null},
    {"tool": "wallet_analytics", "next_tool": null}
  ],
  "user_message": "Check balance of 0x2514844F312c02Ae3C9d4fEb40db4eC8830b6844 and get ETH price",
  "private_key": null
}

3. Complex Flow (Deploy → Airdrop → DAO)
{
  "tools": [
    {"tool": "deploy_erc20", "next_tool": "airdrop"},
    {"tool": "airdrop", "next_tool": "create_dao"},
    {"tool": "create_dao", "next_tool": null}
  ],
  "user_message": "Deploy 'CommunityToken' (COMM, 1000000 supply), airdrop 100 to 0x5732..., create 'Community DAO' (7 days, 60% quorum)",
  "private_key": "0x7a425200e31e8409c27abbc9aaae49a94c314426ef2e569d3a33ffc289a34e76"
}
