import type ts from "typescript";

type Accessibility = "public" | "private" | "protected";
export interface Config {
	casing?: "camelCase" | "PascalCase" | "snake_case";
	injectableIdentifiers?: string[];
	accessibility?: Accessibility | `${Accessibility}-readonly`;
	constructorOrder?: "top" | "preFields" | "preMethods";
	constructorPadding?: "before" | "after" | "both";
}

export interface PluginCreateInfo {
	project: import("typescript/lib/tsserverlibrary").server.Project;
	serverHost: import("typescript/lib/tsserverlibrary").server.ServerHost;
	languageService: ts.LanguageService;
	languageServiceHost: ts.LanguageServiceHost;
	config: Config;
}
