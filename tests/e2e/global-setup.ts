import { startStack, stopStack } from './stack';

export default async function globalSetup() {
  stopStack();
  await startStack();
  return async () => stopStack();
}
