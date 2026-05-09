export interface OnboardStep {
	step: string;
	status: "pass" | "skip" | "fail" | "warn" | "manual_required";
	detail: string;
}
