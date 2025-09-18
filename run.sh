#!/bin/bash
set -e

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo "Shutting down"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    jobs -p | xargs -r kill 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

test_api() {
    local endpoint="$1"
    local data="$2"
    local description="$3"
    
    echo "$description"
    
    local response
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" "http://localhost:8080$endpoint" 2>&1)
    else
        response=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:8080$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>&1)
    fi
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        local message=$(echo "$body" | jq -r '.message // "OK"' 2>/dev/null || echo "OK")
        echo "  $message"
    else
        echo "  Error: HTTP $http_code"
    fi
}

# Setup
echo "Installing dependencies"
if ! pnpm install --recursive > /tmp/install.log 2>&1; then
    echo "Error: Failed to install dependencies"
    cat /tmp/install.log
    exit 1
fi

echo "Running code generation"
if command -v buf >/dev/null 2>&1; then
    if ! buf generate > /tmp/buf-generate.log 2>&1; then
        echo "Warning: buf generate failed"
        cat /tmp/buf-generate.log
    fi
else
    echo "Warning: buf not found, skipping"
fi

# Skip type checking for faster startup

cd backend
pnpm dev-stable &
BACKEND_PID=$!
cd ..

echo "Waiting for server"

server_ready=false
for i in {1..20}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        server_ready=true
        break
    fi
    
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        echo "Server crashed during startup"
        exit 1
    fi
    
    printf "."
    sleep 1
done

if [ "$server_ready" = false ]; then
    echo "Server failed to start"
    exit 1
fi

echo ""
echo "Server ready"

echo ""
echo "Starting frontend (in background)"
cd frontend
pnpm dev > /tmp/frontend-$(date +%s).log 2>&1 &
FRONTEND_PID=$!
cd ..

echo "Waiting for frontend"
frontend_ready=false
for i in {1..10}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        frontend_ready=true
        break
    fi
    printf "."
    sleep 1
done

if [ "$frontend_ready" = false ]; then
    echo ""
    echo "Frontend failed to start"
else
    echo ""
    echo "Frontend ready!"
fi


echo "Backend API: http://localhost:8080"
echo "Frontend App: http://localhost:3000"  
echo "WebSocket Stream: ws://localhost:8080/ws"
echo ""
echo "1. Open http://localhost:3000 in browser"
echo ""
echo "BACKEND LOGS"

wait