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
const supportedCoreExports = ["api", "topLangs", "pin", "wakatime", "gist"];

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
 * Build the map of supported card handlers from the loaded core module.
 * @param {Record<string, unknown>} coreModule Loaded core package module.
 * @returns {Record<string, Function>} Card handlers.
 */
const createCardHandlers = (coreModule) => {
  for (const exportName of supportedCoreExports) {
    if (typeof coreModule[exportName] !== "function") {
      throw new Error(
        `Loaded ${CORE_PACKAGE_NAME} does not expose the expected '${exportName}' function.`,
      );
    }
  }

  return {
    stats: coreModule.api,
    "top-langs": coreModule.topLangs,
    pin: coreModule.pin,
    wakatime: coreModule.wakatime,
    gist: coreModule.gist,
  };
};

/**
 * Normalize option values to strings.
 * @param {Record<string, unknown>} options Input options.
 * @returns {Record<string, string>} Normalized options.
 */
const normalizeOptions = (options) => {
  const normalized = {};
  for (const [key, val] of Object.entries(options)) {
    if (Array.isArray(val)) {
      normalized[key] = val.join(",");
    } else if (val === null || val === undefined) {
      continue;
    } else {
      normalized[key] = String(val);
    }
  }
  return normalized;
};

/**
 * Parse options from query string or JSON and normalize values to strings.
 * @param {string} value Input value.
 * @returns {Record<string, string>} Parsed options.
 */
const parseOptions = (value) => {
  if (!value) {
    return {};
  }

  const trimmed = value.trim();
  const options = {};
  if (trimmed.startsWith("{")) {
    try {
      Object.assign(options, JSON.parse(trimmed));
    } catch {
      throw new Error("Invalid JSON in options.");
    }
  } else {
    const queryString = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const params = new URLSearchParams(queryString);
    for (const [key, val] of params.entries()) {
      if (options[key]) {
        options[key] = `${options[key]},${val}`;
      } else {
        options[key] = val;
      }
    }
  }

  return normalizeOptions(options);
};

/**
 * Validate required options for each card type.
 * @param {string} card Card type.
 * @param {Record<string, string>} query Parsed options.
 * @param {string | undefined} repoOwner Repository owner from environment.
 * @throws {Error} If required options are missing.
 */
const validateCardOptions = (card, query, repoOwner) => {
  if (!query.username && repoOwner) {
    query.username = repoOwner;
    warning("username not provided; defaulting to repository owner.");
  }
  switch (card) {
    case "stats":
    case "top-langs":
    case "wakatime":
      if (!query.username) {
        throw new Error(`username is required for the ${card} card.`);
      }
      break;
    case "pin":
      if (!query.repo) {
        throw new Error("repo is required for the pin card.");
      }
      break;
    case "gist":
      if (!query.id) {
        throw new Error("id is required for the gist card.");
      }
      break;
    default:
      break;
  }
};

const run = async () => {
  const card = getInput("card", { required: true }).toLowerCase();
  const optionsInput = getInput("options") || "";
  const outputPathInput = getInput("path");
  const coreVersion = validateCoreVersion(getInput("core_version") || "");

  const coreModule = await loadCoreModule(coreVersion);

  // Map of card types to their respective API handlers.
  const cardHandlers = createCardHandlers(coreModule);
  const handler = cardHandlers[card];
  if (!handler) {
    throw new Error(`Unsupported card type: ${card}`);
  }

  const query = parseOptions(optionsInput);

  validateCardOptions(card, query, process.env.GITHUB_REPOSITORY_OWNER);

  const outputPathValue =
    outputPathInput || path.join("profile", `${card}.svg`);
  const outputPath = path.resolve(process.cwd(), outputPathValue);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const svg = (await handler(query))?.content;
  if (!svg) {
    throw new Error("Card renderer returned empty output.");
  }

  await writeFile(outputPath, svg, "utf8");
  info(`Wrote ${outputPath}`);
  setOutput("path", outputPathValue);
};

run().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
