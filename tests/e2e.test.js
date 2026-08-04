import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoOwner = process.env.GITHUB_REPOSITORY_OWNER ?? "rickstaa";
let buildDir;

const runCard = (card, options, output, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(rootDir, "index.js")], {
      stdio: "inherit",
      env: {
        ...process.env,
        INPUT_CARD: card,
        INPUT_OPTIONS: options,
        INPUT_PATH: output,
        ...extraEnv,
      },
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Card ${card} failed with code ${code}`));
      }
    });
  });

const assertSvg = async (filePath) => {
  const data = await readFile(filePath, "utf8");
  expect(data).toContain("<svg");
};

beforeAll(async () => {
  buildDir = await mkdtemp(path.join(os.tmpdir(), "grs-action-"));
});

afterAll(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

describe.concurrent("generate cards locally", () => {
  test("generated stats card contains svg", async () => {
    const statsPath = path.join(buildDir, "stats.svg");
    await runCard("stats", `username=${repoOwner}&show_icons=true`, statsPath);
    await assertSvg(statsPath);
  });

  test("generated top-langs card contains svg", async () => {
    const langsPath = path.join(buildDir, "top-langs.svg");
    await runCard(
      "top-langs",
      `username=${repoOwner}&layout=compact&langs_count=6`,
      langsPath,
    );
    await assertSvg(langsPath);
  });

  test("generated pin card contains svg", async () => {
    const pinPath = path.join(
      buildDir,
      "pin-stats-organization-github-readme-stats.svg",
    );
    await runCard(
      "pin",
      "username=stats-organization&repo=github-readme-stats",
      pinPath,
    );
    await assertSvg(pinPath);
  });

  test("generated wakatime card contains svg", async () => {
    const wakatimePath = path.join(buildDir, "wakatime.svg");
    await runCard("wakatime", "username=MNZ&layout=compact", wakatimePath);
    await assertSvg(wakatimePath);
  });

  test("fails when fail_on_error is enabled and the renderer reports an error", async () => {
    // An invalid locale makes the core renderer return an "error - permanent"
    // result offline (no network), which the action must surface as a failure
    // when fail_on_error is opted into.
    const errorPath = path.join(buildDir, "error-fails.svg");

    await expect(
      runCard("stats", `username=${repoOwner}&locale=zzinvalid`, errorPath, {
        INPUT_FAIL_ON_ERROR: "true",
      }),
    ).rejects.toThrow();

    // The error card must not be written when the action fails.
    await expect(readFile(errorPath, "utf8")).rejects.toThrow();
  });

  test("writes the error card by default (fail_on_error off)", async () => {
    // Default behaviour: the action writes the error card and succeeds.
    const errorPath = path.join(buildDir, "error-allowed.svg");

    await runCard("stats", `username=${repoOwner}&locale=zzinvalid`, errorPath);

    const data = await readFile(errorPath, "utf8");
    expect(data).toContain("<svg");
    expect(data).toContain("Something went wrong");
  });
});
