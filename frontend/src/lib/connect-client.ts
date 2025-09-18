import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { CryptoStreamService } from '../gen/proto/crypto_stream/v1/service_connect';

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
});

export const cryptoStreamClient = createPromiseClient(CryptoStreamService, transport);