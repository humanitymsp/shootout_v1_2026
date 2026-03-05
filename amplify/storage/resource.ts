import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'ftpc-storage',
  access: (allow) => ({
    'audit-logs/*': [allow.authenticated.to(['read', 'write'])],
    'reports/*': [allow.authenticated.to(['read', 'write'])],
  }),
});
