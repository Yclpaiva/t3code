// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { OpenCodeSettings } from "@t3tools/contracts";

import {
  haveOpenCodeSnapshotSettingsChanged,
  openCodeAuthJsonPath,
  openCodeModelsCachePath,
  readOpenCodeInventoryEpoch,
} from "./opencodeInventoryEpoch.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

function makeOpenCodeSettings(binaryPath: string): OpenCodeSettings {
  return decodeOpenCodeSettings({
    enabled: true,
    binaryPath,
    serverUrl: "",
    serverPassword: "",
    customModels: [],
  });
}

it.layer(NodeServices.layer)("opencodeInventoryEpoch", (it) => {
  describe("openCodeAuthJsonPath", () => {
    it("prefers XDG_DATA_HOME over HOME", () => {
      NodeAssert.equal(
        openCodeAuthJsonPath({ XDG_DATA_HOME: "/xdg/data", HOME: "/home/yuri" }),
        "/xdg/data/opencode/auth.json",
      );
    });

    it("falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
      NodeAssert.equal(
        openCodeAuthJsonPath({ HOME: "/home/yuri" }),
        "/home/yuri/.local/share/opencode/auth.json",
      );
    });

    it("resolves the OpenCode models cache through XDG_CACHE_HOME", () => {
      NodeAssert.equal(
        openCodeModelsCachePath({ XDG_CACHE_HOME: "/xdg/cache", HOME: "/home/yuri" }),
        "/xdg/cache/opencode/models.json",
      );
      NodeAssert.equal(
        openCodeModelsCachePath({ HOME: "/home/yuri" }),
        "/home/yuri/.cache/opencode/models.json",
      );
    });
  });

  describe("haveOpenCodeSnapshotSettingsChanged", () => {
    it("treats inventory epoch changes as a settings change", () => {
      const provider = makeOpenCodeSettings("opencode");
      const previous = {
        provider,
        enableProviderUpdateChecks: false,
        inventoryEpoch: "auth:1|bin:1",
      };
      const next = {
        provider,
        enableProviderUpdateChecks: false,
        inventoryEpoch: "auth:2|bin:1",
      };
      NodeAssert.equal(haveOpenCodeSnapshotSettingsChanged(previous, next), true);
      NodeAssert.equal(haveOpenCodeSnapshotSettingsChanged(previous, previous), false);
    });
  });

  describe("readOpenCodeInventoryEpoch", () => {
    it.effect("changes when auth, model cache, or the OpenCode binary mtime changes", () => {
      const authTime = 1_777_000_000_000;
      const modelsTime = authTime + 60_000;
      const binaryTime = modelsTime + 60_000;
      return Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-epoch-" });
        const binDir = NodePath.join(tempDir, "bin");
        const dataDir = NodePath.join(tempDir, "share");
        const cacheDir = NodePath.join(tempDir, "cache");
        const authDir = NodePath.join(dataDir, "opencode");
        const modelsDir = NodePath.join(cacheDir, "opencode");
        NodeFS.mkdirSync(binDir, { recursive: true });
        NodeFS.mkdirSync(authDir, { recursive: true });
        NodeFS.mkdirSync(modelsDir, { recursive: true });
        const binaryPath = NodePath.join(binDir, "opencode");
        const authPath = NodePath.join(authDir, "auth.json");
        const modelsPath = NodePath.join(modelsDir, "models.json");
        NodeFS.writeFileSync(binaryPath, "#!/bin/sh\n");
        NodeFS.chmodSync(binaryPath, 0o755);
        NodeFS.writeFileSync(authPath, "{}\n");
        NodeFS.writeFileSync(modelsPath, "{}\n");

        const env = {
          HOME: NodeOS.homedir(),
          XDG_DATA_HOME: dataDir,
          XDG_CACHE_HOME: cacheDir,
          PATH: binDir,
        };
        const first = yield* readOpenCodeInventoryEpoch({
          binaryPath: "opencode",
          environment: env,
        });
        NodeFS.utimesSync(authPath, authTime, authTime);
        const afterAuth = yield* readOpenCodeInventoryEpoch({
          binaryPath: "opencode",
          environment: env,
        });
        NodeAssert.notEqual(first, afterAuth);

        NodeFS.utimesSync(modelsPath, modelsTime, modelsTime);
        const afterModels = yield* readOpenCodeInventoryEpoch({
          binaryPath: "opencode",
          environment: env,
        });
        NodeAssert.notEqual(afterAuth, afterModels);

        NodeFS.utimesSync(binaryPath, binaryTime, binaryTime);
        const afterBinary = yield* readOpenCodeInventoryEpoch({
          binaryPath: "opencode",
          environment: env,
        });
        NodeAssert.notEqual(afterModels, afterBinary);
      });
    });
  });
});
