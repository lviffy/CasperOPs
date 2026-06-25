# syntax=docker/dockerfile:1.7
#
# BlockOps MCP server — single-stage python:3.14-slim runtime.
#
# Boots `uvicorn mcp_server_sse:app` (the HTTP/SSE transport added in
# Phase 21) on port 8080. The stdio transport (`mcp_server.py`) is also
# available via `docker exec ... python mcp_server.py` for local agents.

FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# System deps: tini for clean SIGTERM, curl for HEALTHCHECK.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so this layer caches when only source changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application source.
COPY dispatcher.py main.py mcp_server.py mcp_server_sse.py state.py ./
COPY tools ./tools
COPY app ./app 2>/dev/null || true
COPY examples ./examples
COPY __tests__ ./__tests__

# Non-root user. python:slim ships with a `nonroot` user.
RUN useradd -m -u 1001 appuser 2>/dev/null || true
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "mcp_server_sse:app", "--host", "0.0.0.0", "--port", "8080"]