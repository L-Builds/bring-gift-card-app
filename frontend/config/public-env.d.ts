export function normalizeBackendUrl(value: string | undefined, options?: { deployed?: boolean }): string;
export function apiBaseUrl(value: string | undefined, options?: { web?: boolean; dev?: boolean }): string;
export function validateGoogleUrl(value: string | undefined, options?: { deployed?: boolean }): void;
