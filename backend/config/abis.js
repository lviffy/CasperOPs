// TokenFactory ABI (Stylus contract)
const FACTORY_ABI = [
  "function createToken(bytes32 name, bytes32 symbol, uint256 decimals, uint256 initial_supply) external returns (uint256)",
  "function getTokenCount() external view returns (uint256)",
  "function getTokenInfo(uint256 token_id) external view returns (bytes32 name, bytes32 symbol, uint256 decimals, uint256 totalSupply, address creator)"
];

// NFTFactory ABI (Stylus contract)
const NFT_FACTORY_ABI = [
  "function initialize(address implementation) external",
  "function create_collection(string name, string symbol, string base_uri) external returns (address)",
  "function get_implementation() external view returns (address)",
  "function get_collection_count() external view returns (uint256)",
  "function get_collection_by_id(uint256 collection_id) external view returns (address)",
  "function get_collection_id(address collection_address) external view returns (uint256)",
  "function get_collections(uint256 start, uint256 count) external view returns (address[])",
  "event CollectionCreated(address indexed creator, address indexed collection_address, string name, string symbol, string base_uri, uint256 collection_id)"
];

// ERC20 Token ABI (for interacting with deployed tokens from Stylus factory)
// Note: This is the TokenFactory contract itself - tokens are identified by token_id
const ERC20_TOKEN_ABI = [
  "function balanceOf(uint256 token_id, address account) external view returns (uint256)",
  "function transfer(uint256 token_id, address to, uint256 amount) external returns (bool)",
  "function transfer(uint256 token_id, address from, address to, uint256 amount) external",
  "function allowance(uint256 token_id, address owner, address spender) external view returns (uint256)",
  "function approve(uint256 token_id, address spender, uint256 amount) external returns (bool)",
  "function transferFrom(uint256 token_id, address from, address to, uint256 amount) external returns (bool)",
  "function getTokenInfo(uint256 token_id) external view returns (bytes32 name, bytes32 symbol, uint256 decimals, uint256 totalSupply, address creator)",
  "function getTokenCount() external view returns (uint256)"
];

// Standard ERC20 ABI (for directly deployed token contracts)
const ERC20_STANDARD_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// ERC721 Collection ABI (Stylus contract)
const ERC721_COLLECTION_ABI = [
  "function initialize(string name, string symbol, string base_uri, address creator) external",
  "function creator() external view returns (address)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function base_uri() external view returns (string)",
  "function baseURI() external view returns (string)",
  "function token_uri(uint256 token_id) external view returns (string)",
  "function tokenURI(uint256 token_id) external view returns (string)",
  "function total_supply() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function balance_of(address owner) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function owner_of(uint256 token_id) external view returns (address)",
  "function ownerOf(uint256 token_id) external view returns (address)",
  "function mint(address to) external returns (uint256)",
  "function burn(uint256 token_id) external returns (bool)",
  "function transfer_from(address from, address to, uint256 token_id) external returns (bool)",
  "function transferFrom(address from, address to, uint256 token_id) external",
  "function safe_transfer_from(address from, address to, uint256 token_id) external returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 token_id) external",
  "function approve(address to, uint256 token_id) external returns (bool)",
  "function get_approved(uint256 token_id) external view returns (address)",
  "function getApproved(uint256 token_id) external view returns (address)",
  "function set_approval_for_all(address operator, bool approved) external returns (bool)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function is_approved_for_all(address owner, address operator) external view returns (bool)",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed token_id)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed token_id)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"
];

module.exports = {
  FACTORY_ABI,
  NFT_FACTORY_ABI,
  ERC20_TOKEN_ABI,
  ERC20_STANDARD_ABI,
  ERC721_COLLECTION_ABI
};
