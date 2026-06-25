from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class ToolConnection(BaseModel):
    tool: str
    next_tool: Optional[str] = None

class AgentRequest(BaseModel):
    tools: List[ToolConnection]
    user_message: str
    private_key: Optional[str] = None
    wallet_address: Optional[str] = None

class AgentResponse(BaseModel):
    agent_response: str
    tool_calls: List[Dict[str, Any]]
    results: List[Dict[str, Any]]

class WorkflowRequest(BaseModel):
    prompt: str

class AITool(BaseModel):
    id: str
    type: str
    name: str
    next_tools: List[str]

class WorkflowResponse(BaseModel):
    agent_id: str
    tools: List[AITool]
    has_sequential_execution: bool
    description: str
    raw_response: Optional[str] = None

