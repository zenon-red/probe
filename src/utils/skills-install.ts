import { execSync } from "node:child_process";

export interface SkillsResult {
	installed: boolean;
	detail: string;
	recovery?: string;
}

export async function installSkills(): Promise<SkillsResult> {
	if (!commandExists("npx")) {
		return {
			installed: false,
			detail: "npx not found in PATH",
			recovery: "Install Node.js/npm to enable skills installation",
		};
	}
	try {
		execSync("npx skills list -g", { stdio: "ignore", timeout: 30000 });
	} catch {
		return {
			installed: false,
			detail: "skills CLI not available",
			recovery: "Run: npm install -g @zenon-red/skills-cli",
		};
	}
	try {
		execSync("npx skills add zenon-red/skills --skill='*' -y -g", {
			stdio: "ignore",
			timeout: 120000,
		});
		return {
			installed: true,
			detail: "Installed zenon-red/skills globally",
		};
	} catch {
		return {
			installed: false,
			detail: "skills add command failed",
			recovery: "Run manually: npx skills add zenon-red/skills --skill='*' -y -g",
		};
	}
}

export async function verifySkills(): Promise<SkillsResult> {
	if (!commandExists("npx")) {
		return {
			installed: false,
			detail: "npx not found in PATH",
		};
	}
	try {
		execSync("npx skills list -g", { stdio: "ignore", timeout: 30000 });
		return {
			installed: true,
			detail: "skills CLI available",
		};
	} catch {
		return {
			installed: false,
			detail: "skills CLI not available or empty",
			recovery: "Run: npx skills add zenon-red/skills --skill='*' -y -g",
		};
	}
}

function commandExists(cmd: string): boolean {
	try {
		execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}
