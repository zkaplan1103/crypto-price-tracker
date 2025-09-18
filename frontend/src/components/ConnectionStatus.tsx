import { ConnectionState } from '../lib/websocket-client';

interface ConnectionStatusProps {
  connectionState: ConnectionState;
  onReconnect: () => void;
}

export function ConnectionStatus({ connectionState, onReconnect }: ConnectionStatusProps) {
  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return '#28a745';
      case 'connecting':
        return '#ffc107';
      case 'disconnected':
      case 'error':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Connection Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <div style={{ 
      padding: '10px',
      marginBottom: '20px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      backgroundColor: '#f8f9fa',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div 
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(),
            display: 'inline-block'
          }}
        />
        <span style={{ fontWeight: 'bold' }}>
          WebSocket: {getStatusText()}
        </span>
      </div>
      
      {(connectionState === 'error' || connectionState === 'disconnected') && (
        <button
          onClick={onReconnect}
          style={{
            padding: '4px 12px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Reconnect
        </button>
      )}
    </div>
  );
}