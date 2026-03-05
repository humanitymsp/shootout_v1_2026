// Type declarations for AWS Amplify v6
// These types are provided by aws-amplify v6 package

declare module 'aws-amplify/auth' {
  export interface SignInInput {
    username: string;
    password: string;
  }

  export interface SignInOutput {
    isSignedIn: boolean;
    nextStep: {
      signInStep: 'DONE' | 'CONFIRM_SIGN_IN_WITH_SMS_OTP' | 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' | 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED';
    };
  }

  export interface ConfirmSignInInput {
    challengeResponse: string;
  }

  export interface ConfirmSignInOutput {
    isSignedIn: boolean;
    nextStep: {
      signInStep: 'DONE' | 'CONFIRM_SIGN_IN_WITH_SMS_OTP' | 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' | 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED';
    };
  }

  export function signIn(input: SignInInput): Promise<SignInOutput>;
  export function confirmSignIn(input: ConfirmSignInInput): Promise<ConfirmSignInOutput>;
  export function signOut(): Promise<void>;
  export function getCurrentUser(): Promise<{
    username: string;
    userId: string;
    signInDetails?: any;
  }>;
}

declare module 'aws-amplify/api' {
  export interface GraphQLOptions {
    query: string;
    variables?: Record<string, any>;
  }

  export interface GraphQLClient {
    graphql(options: GraphQLOptions): Promise<any>;
  }

  export function generateClient(): GraphQLClient;
}

declare module 'aws-amplify/data' {
  export function generateClient<T = any>(): T;
}
