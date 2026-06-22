"""
Sample CrewAI agent that uses the BlockOps MCP server to register an agent
and submit an attestation.

Run with:
    pip install crewai
    python examples/crewai_agent.py --mcp-url http://localhost:8080/mcp
"""

import argparse
import asyncio
import json

import httpx
from crewai import Agent, Task, Crew
from crewai.tools import tool


def mcp_tool_factory(url: str, name: str, description: str):
    @tool(name)
    def _call(params_json: str = "{}") -> str:
        """Call a BlockOps MCP tool by name and return the JSON response."""
        import json as _json
        params = _json.loads(params_json or "{}")
        with httpx.Client() as client:
            r = client.post(url, json={"tool": name, "params": params}, timeout=20.0)
            r.raise_for_status()
            return r.text

    _call.description = description
    _call.name = name
    return _call


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-url", default="http://localhost:8080/mcp")
    parser.add_argument("--agent-id", default="crewai-agent-1")
    args = parser.parse_args()

    register_tool = mcp_tool_factory(args.mcp_url, "register_agent", "Register an agent on the Casper AgentFactory contract.")
    attest_tool = mcp_tool_factory(args.mcp_url, "attest_agent", "Submit an attestation for an agent on the Reputation contract.")
    reputation_tool = mcp_tool_factory(args.mcp_url, "get_reputation", "Look up an agent's current reputation score.")

    agent = Agent(
        role="BlockOps agent operator",
        goal="Register an AI agent on the Casper testnet and submit an attestation.",
        backstory="You are a senior agent operator on the BlockOps platform. You speak MCP.",
        tools=[register_tool, attest_tool, reputation_tool],
    )

    task = Task(
        description=(
            f"Register the agent with id '{args.agent_id}', then submit an attestation with score 95, "
            "then return the agent's current reputation."
        ),
        expected_output="A JSON document with the three MCP tool responses.",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task])
    result = crew.kickoff()
    print(result)


if __name__ == "__main__":
    main()
