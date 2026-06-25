import os
from dotenv import load_dotenv
import google.generativeai as genai
from groq import Groq

load_dotenv()

# Configure API Keys
GROQ_API_KEYS = [
    os.getenv("GROQ_API_KEY1"),
    os.getenv("GROQ_API_KEY2"),
    os.getenv("GROQ_API_KEY3")
]
GROQ_API_KEYS = [key for key in GROQ_API_KEYS if key]  # Filter out None values

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize clients
groq_clients = []
if GROQ_API_KEYS:
    for i, key in enumerate(GROQ_API_KEYS, 1):
        groq_clients.append(Groq(api_key=key))
        print(f"✓ Groq client {i} initialized")
    print(f"✓ Total {len(groq_clients)} Groq client(s) initialized (Primary)")
else:
    print("⚠ No Groq API keys configured")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    print("✓ Gemini configured (Fallback)")

if not GROQ_API_KEYS and not GEMINI_API_KEY:
    raise ValueError("At least one of GROQ_API_KEY1-3 or GEMINI_API_KEY must be set")

# Backend URL - configurable via environment or defaults to localhost
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")

