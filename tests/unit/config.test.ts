import { describe, it, expect } from "bun:test";
import { expandHomeDir, getConfig, clearConfigCache } from "../../src/utils/config.js";
import { homedir } from "os";
import probePackageJson from "../../package.json";
import { readConfigValue } from "../../src/commands/config/shared.js";
import { deriveDefaultGenesisUrlFromPackage } from "../../src/utils/default-genesis-url.js";

describe("Config", () => {
  it("expands home directory", () => {
    const expanded = expandHomeDir("~/test");
    expect(expanded).toBe(`${homedir()}/test`);
  });

  it("leaves absolute paths unchanged", () => {
    const path = "/usr/local/test";
    expect(expandHomeDir(path)).toBe(path);
  });

  it("loads default config", async () => {
    clearConfigCache();
    const config = await getConfig();
    expect(typeof config.issuer).toBe("string");
    expect(config.issuer.length).toBeGreaterThan(0);
    expect(config.passwordMinLength).toBe(8);
    expect(config.tokenCacheDir.length).toBeGreaterThan(0);
    expect(typeof config.defaultGenesisUrl).toBe("string");
    expect(config.defaultGenesisUrl).toMatch(/^https?:\/\//);
    expect(config.defaultGenesisUrl).toMatch(/\/genesis\.json$/);
    expect(config.defaultGenesisUrl).toBe(probePackageJson.probe.defaultGenesisUrl);
  });

  it("allows defaultGenesisUrl to be inspected directly", async () => {
    clearConfigCache();
    await expect(readConfigValue("defaultGenesisUrl")).resolves.toBe(
      probePackageJson.probe.defaultGenesisUrl,
    );
  });

  it("derives default genesis URL from package metadata for forks", () => {
    expect(
      deriveDefaultGenesisUrlFromPackage({
        name: "@acme-co/probe",
        repository: { url: "git+https://github.com/acme-co/probe.git" },
      }),
    ).toBe("https://raw.githubusercontent.com/acme-co/probe/main/orgs/acme-co/genesis.json");
  });

  it("prefers build env default genesis URL over package metadata", () => {
    expect(
      deriveDefaultGenesisUrlFromPackage(
        {
          name: "@acme-co/probe",
          repository: { url: "git+https://github.com/acme-co/probe.git" },
          probe: { defaultGenesisUrl: "https://example.com/from-package/genesis.json" },
        },
        "https://example.com/from-env/genesis.json",
      ),
    ).toBe("https://example.com/from-env/genesis.json");
  });

  it("requires explicit default genesis URL when package name and repo do not match", () => {
    expect(() =>
      deriveDefaultGenesisUrlFromPackage({
        name: "@acme-co/probe",
        repository: { url: "git+https://github.com/other-org/probe.git" },
      }),
    ).toThrow(/does not match/);
  });
});
