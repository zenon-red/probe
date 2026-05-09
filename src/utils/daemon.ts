import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonAdapter {
	id: string;
	displayName: string;
	detectAvailable(): Promise<boolean>;
	install(config: DaemonConfig): Promise<DaemonResult>;
	verify(): Promise<DaemonVerifyResult>;
}

export interface DaemonConfig {
	wallet: string;
	host?: string;
	module?: string;
}

export interface DaemonResult {
	success: boolean;
	detail: string;
}

export interface DaemonVerifyResult {
	active: boolean;
	detail: string;
}

function commandExists(cmd: string): boolean {
	try {
		execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

const systemdAdapter: DaemonAdapter = {
	id: "systemd",
	displayName: "systemd user service",
	async detectAvailable() {
		return commandExists("systemctl");
	},
	async install(config) {
		const home = homedir();
		const serviceDir = join(home, ".config", "systemd", "user");
		const servicePath = join(serviceDir, "probe-nexus.service");
		const probePath = execSync("command -v probe", {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
		const hostLine = config.host
			? `Environment=PROBE_SPACETIME_HOST=${config.host}`
			: "";
		const moduleLine = config.module
			? `Environment=PROBE_SPACETIME_MODULE=${config.module}`
			: "";
		const service = `[Unit]
Description=Probe Nexus daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${probePath} nexus --wallet ${config.wallet}
Restart=always
RestartSec=3
${hostLine}
${moduleLine}

[Install]
WantedBy=default.target
`;
		await mkdir(serviceDir, { recursive: true });
		await writeFile(servicePath, service, { mode: 0o644 });
		try {
			execSync("systemctl --user daemon-reload", {
				stdio: "ignore",
				timeout: 10000,
			});
			execSync("systemctl --user enable probe-nexus", {
				stdio: "ignore",
				timeout: 10000,
			});
			execSync("systemctl --user start probe-nexus", {
				stdio: "ignore",
				timeout: 10000,
			});
		} catch {
			return {
				success: false,
				detail: "Service file written but systemctl failed",
			};
		}
		return {
			success: true,
			detail: "systemd user service installed and started",
		};
	},
	async verify() {
		try {
			execSync("systemctl --user is-active probe-nexus", {
				stdio: "ignore",
				timeout: 5000,
			});
			return { active: true, detail: "systemd user service active" };
		} catch {
			return {
				active: false,
				detail: "systemd user service not active",
			};
		}
	},
};

const launchdAdapter: DaemonAdapter = {
	id: "launchd",
	displayName: "launchd (macOS)",
	async detectAvailable() {
		return process.platform === "darwin" && commandExists("launchctl");
	},
	async install(config) {
		const home = homedir();
		const plistDir = join(home, "Library", "LaunchAgents");
		const plistPath = join(plistDir, "com.zenon.probe-nexus.plist");
		const probePath = execSync("command -v probe", {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
		const envLines: string[] = [];
		if (config.host) {
			envLines.push(
				"<key>PROBE_SPACETIME_HOST</key>",
				`<string>${config.host}</string>`,
			);
		}
		if (config.module) {
			envLines.push(
				"<key>PROBE_SPACETIME_MODULE</key>",
				`<string>${config.module}</string>`,
			);
		}
		const envBlock = envLines.length
			? `<key>EnvironmentVariables</key>\n\t<dict>\n\t\t${envLines.join("\n\t\t")}\n\t</dict>`
			: "";
		const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.zenon.probe-nexus</string>
	<key>ProgramArguments</key>
	<array>
		<string>${probePath}</string>
		<string>nexus</string>
		<string>--wallet</string>
		<string>${config.wallet}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${home}/Library/Logs/probe-nexus.log</string>
	<key>StandardErrorPath</key>
	<string>${home}/Library/Logs/probe-nexus.log</string>
	${envBlock}
</dict>
</plist>`;
		await mkdir(plistDir, { recursive: true });
		await writeFile(plistPath, plist, { mode: 0o644 });
		try {
			execSync("launchctl bootstrap gui/$(id -u) " + plistPath, {
				stdio: "ignore",
				timeout: 10000,
			});
			execSync("launchctl enable gui/$(id -u)/com.zenon.probe-nexus", {
				stdio: "ignore",
				timeout: 10000,
			});
			execSync("launchctl kickstart -k gui/$(id -u)/com.zenon.probe-nexus", {
				stdio: "ignore",
				timeout: 10000,
			});
		} catch {
			return {
				success: false,
				detail: "Plist written but launchctl failed",
			};
		}
		return {
			success: true,
			detail: "launchd agent installed and started",
		};
	},
	async verify() {
		try {
			execSync(
				"launchctl print gui/$(id -u)/com.zenon.probe-nexus",
				{ stdio: "ignore", timeout: 5000 },
			);
			return { active: true, detail: "launchd agent active" };
		} catch {
			return { active: false, detail: "launchd agent not active" };
		}
	},
};

const tmuxAdapter: DaemonAdapter = {
	id: "tmux",
	displayName: "tmux session",
	async detectAvailable() {
		return commandExists("tmux");
	},
	async install(config) {
		try {
			execSync(
				`tmux has-session -t nexus 2>/dev/null || tmux new-session -d -s nexus "probe nexus --wallet ${config.wallet}"`,
				{ stdio: "ignore", timeout: 10000 },
			);
			return {
				success: true,
				detail: "tmux session 'nexus' created",
			};
		} catch {
			return {
				success: false,
				detail: "tmux session creation failed",
			};
		}
	},
	async verify() {
		try {
			execSync("tmux has-session -t nexus", {
				stdio: "ignore",
				timeout: 5000,
			});
			return { active: true, detail: "tmux session 'nexus' exists" };
		} catch {
			return { active: false, detail: "tmux session 'nexus' not found" };
		}
	},
};

const dockerAdapter: DaemonAdapter = {
	id: "docker",
	displayName: "Docker container",
	async detectAvailable() {
		return commandExists("docker");
	},
	async install(_config) {
		return {
			success: false,
			detail: "Docker daemon not implemented in MVP; use manual setup",
		};
	},
	async verify() {
		try {
			const names = execSync(
				'docker ps --filter "name=probe-nexus" --format "{{.Names}}"',
				{
					encoding: "utf-8",
				timeout: 10000,
				},
			).trim();
			if (!names.split("\n").includes("probe-nexus")) {
				return {
					active: false,
					detail: "Docker container probe-nexus not found",
				};
			}
			return { active: true, detail: "Docker container probe-nexus running" };
		} catch {
			return {
				active: false,
				detail: "Docker container probe-nexus not found",
			};
		}
	},
};

const statelessAdapter: DaemonAdapter = {
	id: "stateless",
	displayName: "Stateless",
	async detectAvailable() {
		return true;
	},
	async install() {
		return {
			success: true,
			detail: "Stateless mode selected (no persistent daemon)",
		};
	},
	async verify() {
		return {
			active: false,
			detail: "Stateless mode (no persistent daemon)",
		};
	},
};

export const daemonAdapters: DaemonAdapter[] = [
	systemdAdapter,
	launchdAdapter,
	tmuxAdapter,
	dockerAdapter,
	statelessAdapter,
];

export async function detectDaemon(): Promise<DaemonAdapter> {
	for (const adapter of daemonAdapters) {
		if (adapter.id === "stateless") continue;
		if (await adapter.detectAvailable()) {
			return adapter;
		}
	}
	return statelessAdapter;
}
