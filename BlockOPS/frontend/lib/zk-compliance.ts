/**
 * ZK Compliance Helper.
 * Supports anonymous whitelisting for DeFi pools by generating proof credentials
 * and verifying compliance status on-chain.
 */

export interface ZkComplianceProof {
  proof: string; // The hex-serialized mock ZK proof
  publicInputs: {
    addressHash: string; // SHA-256 of public key to prove identity anonymously
    jurisdiction: string; // e.g. "US", "EU"
    timestamp: number; // Prevent replay attacks
  };
}

/**
 * Generate a mock client-side ZK-KYC compliance proof.
 * This proves anonymously that the given address belongs to a compliant user
 * under the specified jurisdiction without revealing the raw identity to the pool.
 */
export async function generateComplianceProof(
  address: string,
  jurisdiction: string = "US"
): Promise<ZkComplianceProof> {
  const encoder = new TextEncoder();
  const data = encoder.encode(address + jurisdiction + Date.now().toString());
  
  let addressHash: string;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    addressHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback if crypto subtle is not available (like in some test environments)
    addressHash = "0000000000000000000000000000000000000000000000000000000000000000";
  }

  return {
    proof: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    publicInputs: {
      addressHash,
      jurisdiction,
      timestamp: Math.floor(Date.now() / 1000)
    }
  };
}

/**
 * Check if the address is compliant by querying the Compliance contract.
 */
export async function isAddressCompliant(address: string): Promise<boolean> {
  if (!address) return false;
  
  try {
    const response = await fetch(`/v1/tools/compliance_check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: address,
        jurisdiction: "US"
      })
    });
    
    if (!response.ok) return false;
    const data = await response.json();
    return data?.success && data?.result?.compliant === true;
  } catch (err) {
    console.warn("Compliance check failed:", err);
    return false;
  }
}
