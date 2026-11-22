import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Absolute path inside the installed @moguri-dev/sdk package, which owns the service, runtime and worker bundles. */
export const sdkPath = (...parts: string[]): string => join(dirname(createRequire(import.meta.url).resolve("@moguri-dev/sdk/package.json")), ...parts);
