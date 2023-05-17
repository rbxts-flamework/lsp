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

export const LSP_SYMBOL = Symbol("LSP attached");

/**
 * This is a workaround for a TS bug that causes flamework-lsp to be ran multiple times.
 * This adds a marking symbol to the inputted object, and will return false if it already exists.
 * This will prevent Flamework from applying its modifications multiple times.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function attachSymbol(value?: object) {
	if (value !== undefined) {
		if (LSP_SYMBOL in value) {
			return false;
		}

		(value as Record<typeof LSP_SYMBOL, boolean>)[LSP_SYMBOL] = true;
	}

	return true;
}
