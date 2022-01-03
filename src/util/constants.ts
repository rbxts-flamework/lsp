import type ts from "typescript";
import { PluginCreateInfo } from "../types";

export function createConstants(info: PluginCreateInfo) {
	const currentDirectory = info.languageServiceHost.getCurrentDirectory();
	const compilerOptions = info.project.getCompilerOptions() as ts.CompilerOptions;
	const formatOptions = info.project.projectService.getHostFormatCodeOptions();
	const userPreferences = info.project.projectService.getHostPreferences();
	const config = info.config;
	const outDir = compilerOptions.outDir ?? currentDirectory;
	const srcDir = compilerOptions.rootDir ?? currentDirectory;

	return {
		currentDirectory,
		compilerOptions,
		userPreferences,
		formatOptions,
		config,
		outDir,
		srcDir,
	};
}

export const DIAGNOSTIC_CODE = 1800000;

export type Constants = ReturnType<typeof createConstants>;

export interface Harness {
	triggerFormat: () => void;
}
