#!/usr/bin/env node

/**
 * Test script to demonstrate intelligent tool routing vs regex-based routing
 * Run: node test_smart_routing.js
 */

const { intelligentToolRouting, convertToAgentFormat } = require('./services/toolRouter');

// Test cases
const testCases = [
  {
    name: 'Simple Price Query',
    message: 'What is the price of Bitcoin?',
    expected: {
      tools: ['fetch_price'],
      type: 'simple'
    }
  },
  {
    name: 'Complex Multi-Part Query',
    message: 'Tell me how much Solana I can buy with the balance of wallet 0xdA4587b5dc52267a53e48dCDb3595d4e40E32B97 and tell me the current price of Solana',
    expected: {
      tools: ['get_balance', 'fetch_price', 'calculate'],
      type: 'sequential'
    }
  },
  {
    name: 'Parallel Independent Queries',
    message: 'Check my ETH balance and get the current Bitcoin price',
    expected: {
      tools: ['get_balance', 'fetch_price'],
      type: 'parallel'
    }
  },
  {
    name: 'Sequential Workflow',
    message: 'Deploy a token called MyToken with 1 million supply, then transfer 1000 tokens to 0x123',
    expected: {
      tools: ['deploy_erc20', 'transfer'],
      type: 'sequential'
    }
  },
  {
    name: 'Missing Information',
    message: 'Transfer some tokens to Alice',
    expected: {
      missingInfo: true,
      type: 'incomplete'
    }
  }
];

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printSeparator() {
  console.log('\n' + '='.repeat(80) + '\n');
}

async function runTests() {
  log('🧪 INTELLIGENT TOOL ROUTING TEST SUITE', 'bright');
  printSeparator();

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    log(`\n📝 Test: ${testCase.name}`, 'cyan');
    log(`   Message: "${testCase.message}"`, 'blue');
    
    try {
      // Run intelligent routing
      const routingPlan = await intelligentToolRouting(testCase.message);
      
      // Display results
      log('\n   📊 Routing Analysis:', 'yellow');
      log(`      Analysis: ${routingPlan.analysis}`);
      log(`      Requires Tools: ${routingPlan.requires_tools}`);
      log(`      Complexity: ${routingPlan.complexity}`);
      
      if (routingPlan.requires_tools && routingPlan.execution_plan) {
        log(`      Execution Type: ${routingPlan.execution_plan.type}`);
        log(`      Tool Steps: ${routingPlan.execution_plan.steps.length}`);
        
        routingPlan.execution_plan.steps.forEach((step, i) => {
          const deps = step.depends_on?.length > 0 
            ? ` (depends on: ${step.depends_on.join(', ')})` 
            : '';
          log(`         ${i + 1}. ${step.tool}${deps}`, 'green');
          log(`            Reason: ${step.reason}`);
          if (Object.keys(step.parameters || {}).length > 0) {
            log(`            Parameters: ${JSON.stringify(step.parameters)}`);
          }
        });
      }
      
      if (routingPlan.missing_info?.length > 0) {
        log('      Missing Information:', 'red');
        routingPlan.missing_info.forEach(info => {
          log(`         - ${info}`);
        });
      }
      
      // Convert to agent format
      const agentTools = convertToAgentFormat(routingPlan);
      if (agentTools.length > 0) {
        log('\n   🔧 Agent Tool Format:');
        agentTools.forEach(tool => {
          const next = tool.next_tool ? ` → ${tool.next_tool}` : ' (end)';
          log(`      ${tool.tool}${next}`);
        });
      }
      
      // Validation
      let testPassed = true;
      if (testCase.expected.missingInfo) {
        testPassed = routingPlan.missing_info?.length > 0;
      } else if (testCase.expected.type === 'sequential') {
        testPassed = routingPlan.execution_plan?.type === 'sequential';
      } else if (testCase.expected.type === 'parallel') {
        testPassed = routingPlan.execution_plan?.type === 'parallel';
      }
      
      if (testPassed) {
        log('\n   ✅ TEST PASSED', 'green');
        passed++;
      } else {
        log('\n   ❌ TEST FAILED', 'red');
        failed++;
      }
      
    } catch (error) {
      log(`\n   ❌ ERROR: ${error.message}`, 'red');
      failed++;
    }
    
    printSeparator();
  }

  // Summary
  log(`\n📈 TEST SUMMARY`, 'bright');
  log(`   Total Tests: ${testCases.length}`);
  log(`   Passed: ${passed}`, 'green');
  log(`   Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`   Success Rate: ${((passed / testCases.length) * 100).toFixed(1)}%\n`, 'cyan');
}

// Run tests
if (require.main === module) {
  log('\n🚀 Starting Smart Tool Routing Tests...', 'bright');
  
  runTests()
    .then(() => {
      log('✨ Tests completed!\n', 'green');
      process.exit(0);
    })
    .catch(error => {
      log(`\n❌ Fatal Error: ${error.message}\n`, 'red');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runTests };
