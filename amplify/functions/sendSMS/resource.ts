import { defineFunction } from '@aws-amplify/backend';

export const sendSMSFunction = defineFunction({
  entry: './handler.ts',
});
