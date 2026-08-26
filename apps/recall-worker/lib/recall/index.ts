// Recall Module - Product Recall Discovery via FDA + CPSC APIs
// Replaces lib/ecfr/ with recall-focused pipeline
// All data is fetched dynamically from openFDA and CPSC APIs + reasoning model

export * from '@recall/shared/recall/fda-client';
export * from './cpsc-client.ts';
export * from './recall-discovery.ts';

// Re-export key instances
export { fdaClient } from '@recall/shared/recall/fda-client';
export { cpscClient } from './cpsc-client.ts';
export { recallDiscovery } from './recall-discovery.ts';
