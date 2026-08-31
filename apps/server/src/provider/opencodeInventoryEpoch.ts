import type { OpenCodeSettings, ServerSettings, ServerSettingsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type * as ServerSettingsModule from "../serverSettings.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettings,
  type ProviderSnapshotSettings,
} from "./providerUpdateSettings.ts";

/**
 * Cheap poll so OpenCode re-probes when auth or the binary changes, instead of
 * waiting for the demand-gated health interval.
 */
export const OPENCODE_INVENTORY_POLL_INTERVAL = "15 seconds" as const;

export type OpenCodeSnapshotSettings = ProviderSnapshotSettings<OpenCodeSettings> & {
  readonly inventoryEpoch: string;
};

export function haveOpenCodeSnapshotSettingsChanged(
  previous: OpenCodeSnapshotSettings,
  next: OpenCodeSnapshotSettings,
): boolean {
  return (
    previous.inventoryEpoch !== next.inventoryEpoch ||
    haveProviderSnapshotSettingsChanged(
      {
        provider: previous.provider,
        enableProviderUpdateChecks: previous.enableProviderUpdateChecks,
      },
      {
        provider: next.provider,
        enableProviderUpdateChecks: next.enableProviderUpdateChecks,
      },
    )
  );
}

export function openCodeAuthJsonPath(env: NodeJS.ProcessEnv): string | null {
  const xdgData = env.XDG_DATA_HOME?.trim();
  if (xdgData) {
    return `${xdgData.replace(/\/+$/, "")}/opencode/auth.json`;
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) {
    return null;
  }
  return `${home.replace(/\/+$/, "")}/.local/share/opencode/auth.json`;
}

function splitPathValue(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const raw = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = raw.includes(";") && !raw.includes(":") ? ";" : ":";
  return raw.split(delimiter).filter((segment) => segment.length > 0);
}

function fileMtimeMs(filePath: string | null): Effect.Effect<number, never, FileSystem.FileSystem> {
  if (!filePath) {
    return Effect.succeed(0);
  }
  return FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(filePath)),
    Effect.map((info) =>
      Option.match(info.mtime, { onNone: () => 0, onSome: (mtime) => mtime.getTime() }),
    ),
    Effect.orElseSucceed(() => 0),
  );
}

function resolveOpenCodeBinaryPath(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const configured = binaryPath.trim() || "opencode";
    if (configured.includes("/") || configured.includes("\\")) {
      return configured;
    }
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    for (const directory of splitPathValue(env)) {
      const candidate = path.join(directory, configured);
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return candidate;
      }
    }
    return null;
  });
}

/**
 * Identity of the OpenCode catalog inputs T3 can observe without spawning CLI.
 * Does not include secret values, only mtimes of auth.json and the resolved binary.
 */
export const readOpenCodeInventoryEpoch = Effect.fn("readOpenCodeInventoryEpoch")(
  function* (input: { readonly binaryPath: string; readonly environment?: NodeJS.ProcessEnv }) {
    const env = input.environment ?? process.env;
    const resolvedBinary = yield* resolveOpenCodeBinaryPath(input.binaryPath, env);
    const [authMtimeMs, binaryMtimeMs] = yield* Effect.all(
      [fileMtimeMs(openCodeAuthJsonPath(env)), fileMtimeMs(resolvedBinary)],
      { concurrency: "unbounded" },
    );
    return `auth:${authMtimeMs}|bin:${binaryMtimeMs}`;
  },
);

export function makeOpenCodeSnapshotSettingsSource(
  provider: OpenCodeSettings,
  serverSettings: ServerSettingsModule.ServerSettingsService["Service"],
  environment?: NodeJS.ProcessEnv,
): {
  readonly getSettings: Effect.Effect<
    OpenCodeSnapshotSettings,
    ServerSettingsError,
    FileSystem.FileSystem | Path.Path
  >;
  readonly streamSettings: Stream.Stream<
    OpenCodeSnapshotSettings,
    never,
    FileSystem.FileSystem | Path.Path
  >;
} {
  const readEpoch = readOpenCodeInventoryEpoch({
    binaryPath: provider.binaryPath,
    ...(environment === undefined ? {} : { environment }),
  });
  const withEpoch = (
    settings: ServerSettings,
    inventoryEpoch: string,
  ): OpenCodeSnapshotSettings => ({
    ...makeProviderSnapshotSettings(provider, settings),
    inventoryEpoch,
  });

  const getSettings = serverSettings.getSettings.pipe(
    Effect.flatMap((settings) =>
      readEpoch.pipe(Effect.map((inventoryEpoch) => withEpoch(settings, inventoryEpoch))),
    ),
  );

  const epochChanges = Stream.tick(OPENCODE_INVENTORY_POLL_INTERVAL).pipe(
    Stream.mapEffect(() => readEpoch),
    Stream.changes,
  );

  return {
    getSettings,
    streamSettings: Stream.merge(
      serverSettings.streamChanges.pipe(
        Stream.mapEffect((settings) =>
          readEpoch.pipe(Effect.map((inventoryEpoch) => withEpoch(settings, inventoryEpoch))),
        ),
      ),
      epochChanges.pipe(
        Stream.mapEffect((inventoryEpoch) =>
          serverSettings.getSettings.pipe(
            Effect.map((settings) => withEpoch(settings, inventoryEpoch)),
            Effect.catch((cause) =>
              Effect.logWarning("Could not read server settings for the OpenCode inventory poll.", {
                cause,
              }).pipe(Effect.as(undefined)),
            ),
          ),
        ),
        Stream.filter((settings): settings is OpenCodeSnapshotSettings => settings !== undefined),
      ),
    ),
  };
}
