export function inspectPNG(bytes: Uint8Array): Record<string, unknown>;
export function runPipeline(bytes: Uint8Array, options?: unknown, includeSequence?: boolean): {inspection:Record<string,unknown>;atlasPng:Uint8Array;atlasJSON:string;sequenceZip:Uint8Array;metadata:Record<string,unknown>;summary:Record<string,number>};

export function decodePNG(bytes: Uint8Array): unknown;
export function inspectImage(image: unknown): Record<string, unknown>;
