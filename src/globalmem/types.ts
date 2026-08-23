export interface GlobalMemoryDeclaration { name: string; paths: string[]; }
export interface DriftReport { name: string; paths: string[]; hashes: Record<string, string>; inSync: boolean; divergentPaths?: string[]; }
