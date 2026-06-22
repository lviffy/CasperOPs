# BlockOps - Frontend

This is the frontend application for BlockOps, built with [Next.js](https://nextjs.org).

## Features

- 🎨 **Visual Drag & Drop Workflow Builder** - Create blockchain automation workflows with an intuitive visual interface
- 🤖 **AI-Powered Agent Generation** - Generate agents using AI based on your requirements
- 🔗 **Blockchain Integration** - Interact with BlockOps testnet smart contracts
- 🛠️ **10+ Blockchain Tools** - Token transfers, swaps, NFT/Token deployment, DAO creation, airdrops, and more
- 💼 **Wallet Management** - Create agent wallets or import existing ones
- 📊 **Real-time Updates** - See your workflows execute in real-time
- 🔍 **Contract Explorer** - Interact with any deployed smart contract like a block explorer (NEW!)

## Lit Private Key Security

Private keys are stored as Lit-encrypted ciphertext (not plaintext).

See setup instructions: [LIT_PROTOCOL_SETUP.md](./LIT_PROTOCOL_SETUP.md)

## New: Contract Explorer

The Contract Explorer allows you to interact with any deployed smart contract by simply entering its address. Features include:

- **Automatic ABI Fetching** - Load contract functions from verified contracts
- **Read Functions** - Query contract state without gas costs
- **Write Functions** - Execute transactions with your connected wallet
- **Function Discovery** - View all available contract functions with parameters
- **Transaction Tracking** - Get transaction hashes and explorer links

[📖 Read the full Contract Explorer documentation](./CONTRACT_EXPLORER.md)

## Getting Started



```bashTo learn more about Next.js, take a look at the following resources:

npm install

# or- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.

yarn install- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

# or

pnpm installYou can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

```

## Deploy on Vercel

2. Run the development server:

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

```bash

npm run devCheck out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# or
yarn dev
# or
pnpm dev
# or
bun dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Key Components

- **Workflow Builder** (`components/workflow-builder.tsx`) - Main drag & drop interface
- **Node Library** (`components/node-library.tsx`) - Available blockchain tools
- **Agent Nodes** (`components/nodes/`) - Individual tool components
- **AI Chat Modal** (`components/ai-chat-modal.tsx`) - AI-powered agent generation

## Project Structure

```
frontend/
├── app/                 # Next.js app directory
│   ├── agent-builder/   # Agent builder page
│   ├── my-agents/       # User's agents page
│   └── api/            # API routes (empty - backend removed)
├── components/         # React components
│   ├── nodes/         # Custom node components
│   └── ui/            # UI components
├── lib/               # Utility functions and types
└── hooks/             # Custom React hooks
```

## Technologies Used

- **Next.js 14+** - React framework
- **TypeScript** - Type safety
- **React Flow** - Workflow visualization and drag & drop
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **Supabase** - Authentication and data storage
- **ethers.js** - Blockchain interaction

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [React Flow Documentation](https://reactflow.dev)
- [Arbitrum Sepolia Network](https://docs.arbitrum.io/for-devs/concepts/public-chains)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
