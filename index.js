import { exec } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { getInput, info, setFailed, setOutput, warning } from "@actions/core";

const execAsync = promisify(exec);
const CORE_PACKAGE_NAME = "@stats-organization/github-readme-stats-core";

const validateCoreVersion = (value) => {
  const pattern = /^[a-zA-Z0-9._-]*$/;
  if (!pattern.test(value)) {
    throw new Error("core_version must contain only a-zA-Z0-9._- characters.");
  }
  return value;
};

/**
 * Install the requested core package into an isolated temporary directory.
 * @param {string} version Package version.
 * @returns {Promise<string>} Directory containing the installed package.
 */
const installCorePackage = async (version) => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), "grs-core-"));
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packageSpec = `${CORE_PACKAGE_NAME}@${version}`;

  try {
    await writeFile(
      path.join(installDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
      "utf8",
    );

    await execAsync(
      `${npmCommand} install --no-save --ignore-scripts --no-package-lock ${packageSpec}`,
      {
        cwd: installDir,
        env: process.env,
      },
    );

    return installDir;
  } catch (error) {
    throw new Error(
      `Failed to install ${CORE_PACKAGE_NAME}@${version}: ${error}`,
    );
  }
};

/**
 * Load the core package either from the bundled dependency or from an isolated install.
 * @param {string} version Package version.
 * @returns {Promise<Record<string, unknown>>} Loaded module and cleanup callback.
 */
const loadCoreModule = async (version) => {
  if (!version) {
    return await import(CORE_PACKAGE_NAME);
  }

  const installDir = await installCorePackage(version);
  const installRequire = createRequire(path.join(installDir, "package.json"));
  const modulePath = installRequire.resolve(CORE_PACKAGE_NAME);
  return await import(pathToFileURL(modulePath).href);
};

/**
 * Map of supported card types to the core export to call and the option each requires.
 * @type {Record<string, { exportName: string, requires: string }>}
 */
const CARDS = {
  stats: { exportName: "api", requires: "username" },
  "top-langs": { exportName: "topLangs", requires: "username" },
  pin: { exportName: "pin", requires: "repo" },
  wakatime: { exportName: "wakatime", requires: "username" },
  gist: { exportName: "gist", requires: "id" },
};

/**
 * Parse options from query string or JSON and normalize values to strings.
 * @param {string} value Input value.
 * @returns {Record<string, string>} Parsed options.
 */
const parseOptions = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid JSON in options.");
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, val]) => val !== null && val !== undefined)
        .map(([key, val]) => [
          key,
          Array.isArray(val) ? val.join(",") : String(val),
        ]),
    );
  }

  // URLSearchParams strips a single leading "?" natively.
  const params = new URLSearchParams(trimmed);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => [
      key,
      params.getAll(key).join(","),
    ]),
  );
};

/**
 * Validate the requested card and resolve its handler.
 * @param {Record<string, unknown>} coreModule Loaded core package module.
 * @param {string} card Card type.
 * @param {Record<string, string>} query Parsed options.
 * @returns {Function} Card handler.
 * @throws {Error} If the card, a core export or a required option is missing.
 */
const resolveCardHandler = (coreModule, card, query) => {
  const cardDef = CARDS[card];
  if (!cardDef) {
    throw new Error(`Unsupported card type: ${card}`);
  }

  for (const { exportName } of Object.values(CARDS)) {
    if (typeof coreModule[exportName] !== "function") {
      throw new Error(
        `Loaded ${CORE_PACKAGE_NAME} does not expose the expected '${exportName}' function.`,
      );
    }
  }

  if (!query[cardDef.requires]) {
    throw new Error(`${cardDef.requires} is required for the ${card} card.`);
  }

  return coreModule[cardDef.exportName];
};

const run = async () => {
  const card = getInput("card", { required: true }).toLowerCase();
  const optionsInput = getInput("options");
  const outputPathInput = getInput("path");
  const coreVersion = validateCoreVersion(getInput("core_version"));
  const failOnError = /^(true|1|yes)$/i.test(getInput("fail_on_error"));

  const coreModule = await loadCoreModule(coreVersion);

  const query = parseOptions(optionsInput);
  if (!query.username && process.env.GITHUB_REPOSITORY_OWNER) {
    query.username = process.env.GITHUB_REPOSITORY_OWNER;
    warning("username not provided; defaulting to repository owner.");
  }

  const handler = resolveCardHandler(coreModule, card, query);

  const outputPathValue =
    outputPathInput || path.join("profile", `${card}.svg`);
  const outputPath = path.resolve(process.cwd(), outputPathValue);

  const result = await handler(query);
  const svg = result?.content;

  // The core renderer never throws on a data-fetch error; it returns a `status`
  // starting with "error" and a "Something went wrong" SVG. When fail_on_error
  // is enabled, fail the action so the broken card is never written or committed.
  // Older core versions may not return a `status`, so this is a no-op for them.
  if (failOnError && String(result?.status).startsWith("error")) {
    throw new Error(
      `Card generation failed while fetching data (${result.status}).`,
    );
  }

  if (!svg) {
    throw new Error("Card renderer returned empty output.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
  info(`Wrote ${outputPath}`);
  setOutput("path", outputPathValue);
};

run().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
