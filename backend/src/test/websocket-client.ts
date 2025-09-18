import WebSocket from 'ws';

export async function testWebSocketConnection(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8080/ws');
    let connected = false;
    let pingReceived = false;
    
    const timeout = setTimeout(() => {
      console.log('WebSocket test timeout');
      resolve(false);
    }, 5000);

    ws.on('open', () => {
      console.log('WebSocket connected');
      connected = true;
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'pong') {
        console.log('WebSocket ping/pong working');
        pingReceived = true;
        clearTimeout(timeout);
        ws.close();
        resolve(connected && pingReceived);
      }
    });

    ws.on('error', (error) => {
      console.log('WebSocket error:', error.message);
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(connected && pingReceived);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testWebSocketConnection().then(success => {
    process.exit(success ? 0 : 1);
  });
}