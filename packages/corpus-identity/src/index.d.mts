export declare const PHYSICAL_ID_SCHEMA_VERSION: 'v2'
export declare const PHYSICAL_ID_MAX_BYTES: 64
export declare const CORPUS_NAMESPACE_PREFIX: 'nr2'
export declare function canonicalJson(value: unknown): string
export declare function sha256Base64url(value: unknown): string
export declare function sha256Hex(value: unknown): string
export declare function utf8ByteLength(value: string): number
export declare function assertPhysicalId(value: string, label?: string): string
export declare function corpusNamespace(corpusVersion: string, dimensions?: 512 | 768 | 1024): string
export declare function corpusMetadataKey(corpusVersion: string): string
export declare function corpusSourceKey(sourceId: string, corpusVersion: string): string
export declare function vectorPhysicalId(corpusVersion: string, chunkId: string): string
