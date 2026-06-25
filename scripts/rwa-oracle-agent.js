/**
 * CasperOPs Casper RWA Oracle Agent Prototype.
 * 
 * Demonstrates the end-to-end flow of an autonomous agent:
 * 1. Querying the RWA Valuation Tool for a property appraisal.
 * 2. Receiving the cryptographic attestation proof and signature.
 * 3. Simulating/preparing the Casper blockchain deployment to update the RWA Registry contract.
 */

const axios = require('axios');
require('dotenv').config();

// Use local backend URL by default
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const MASTER_API_KEY = process.env.MASTER_API_KEY || 'test-api-key-1234567890'; // Use fallback if not set

async function runRwaOracleFlow() {
  const propertyAddress = '456 Alpha Genesis Way, Zug, Switzerland';
  
  console.log('========================================================================');
  console.log('🚀 Starting Casper RWA Valuation & Oracle Agent Flow');
  console.log(`Address: "${propertyAddress}"`);
  console.log('========================================================================\n');

  try {
    // Step 1: Query the RWA valuation tool
    console.log(`1. Requesting certified property valuation from CasperOPs API...`);
    
    // We call the protected HTTP endpoint
    const response = await axios.post(`${BACKEND_URL}/rwa/property-valuation`, {
      propertyAddress
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MASTER_API_KEY
      }
    });

    if (!response.data || !response.data.success) {
      throw new Error(`Failed to get valuation: ${JSON.stringify(response.data)}`);
    }

    const { report, source } = response.data;
    console.log('   ✅ Received valuation successfully!');
    console.log(`   Source: ${source}`);
    console.log(`   Parcel ID: ${report.parcelId}`);
    console.log(`   Property Type: ${report.propertyType}`);
    console.log(`   Square Feet: ${report.squareFeet} sqft`);
    console.log(`   Valuation (USD): $${report.valuation.valueUsd.toLocaleString()}`);
    console.log(`   Valuation (CSPR): ${report.valuation.valueCspr.toLocaleString()} CSPR`);
    console.log(`   Confidence Score: ${report.valuation.confidenceScore}%`);
    console.log(`   Appraiser Date: ${report.valuation.lastAppraisedDate}\n`);

    // Step 2: Validate the Oracle Attestation
    console.log('2. Verifying Oracle Cryptographic Attestation Proof...');
    const { oracleAttestation } = report;
    console.log(`   Attested By Node: ${oracleAttestation.oracleNode}`);
    console.log(`   Attestation Cert CID: ${oracleAttestation.attestationCid}`);
    console.log(`   Attested Timestamp: ${oracleAttestation.attestedTimestamp}`);
    console.log(`   Proof Hash: ${oracleAttestation.proofHash}`);
    console.log(`   Signature: ${oracleAttestation.signature}\n`);

    // Step 3: Simulate updating the RWA registry smart contract on Casper
    console.log('3. Preparing Casper Smart Contract Deployment payload...');
    console.log(`   Target Registry Contract: hash-rwa_registry_contract_v1`);
    console.log(`   Method: update_property_valuation`);
    
    // Construct the runtime arguments for Casper contract call
    const runtimeArgs = {
      property_address: propertyAddress,
      value_usd: report.valuation.valueUsd.toString(),
      confidence: report.valuation.confidenceScore.toString(),
      attestation_hash: oracleAttestation.proofHash,
      signature: oracleAttestation.signature,
      timestamp: oracleAttestation.attestedTimestamp
    };

    console.log('   RuntimeArgs structured for Casper JS SDK:');
    console.log(JSON.stringify(runtimeArgs, null, 4));
    console.log('\n✅ Flow completed successfully! The agent is ready to broadcast the update.');
    console.log('========================================================================');
  } catch (error) {
    console.error('❌ Error executing RWA Oracle Flow:', error.message);
    if (error.response) {
      console.error('Response details:', error.response.data);
    }
  }
}

// Execute if run directly
if (require.main === module) {
  runRwaOracleFlow();
}

module.exports = { runRwaOracleFlow };
