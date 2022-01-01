import type ts from "typescript";
import { createConstants, Harness } from "./constants";
import { expect } from "./functions/expect";
import { PluginCreateInfo } from "../types";
import path from "path";
import { isPathDescendantOf } from "./functions/isPathDescendantOf";
import jsConvert from "js-convert-case";

export class Provider {
	public constants = createConstants(this.info);
	public harness?: Harness;
	public ts: typeof ts;

	public currentDirectory = this.constants.currentDirectory;
	public projectService = this.info.project.projectService;
	public config = this.constants.config;
	public logger = this.projectService.logger;
	public srcDir = this.constants.srcDir;
	public modulesDir: string;

	constructor(
		public serviceProxy: ts.LanguageService,
		public service: ts.LanguageService,
		public info: PluginCreateInfo,
		tsImpl: typeof ts,
	) {
		this.ts = tsImpl;

		const pkgJsonPath = tsImpl.findPackageJson(this.currentDirectory, info.languageServiceHost);
		this.modulesDir = path.join(pkgJsonPath ? path.dirname(pkgJsonPath) : this.currentDirectory, `node_modules`);
	}

	get program() {
		return expect(this.service.getProgram(), "getProgram");
	}

	get typeChecker() {
		return this.program.getTypeChecker();
	}

	/**
	 * Checks if the specified file is part of module
	 */
	isFileInModule(file: ts.SourceFile, module: string) {
		return isPathDescendantOf(file.fileName, path.join(this.modulesDir, module));
	}

	/**
	 * Converts casing to user-configured casing
	 */
	convertCase(str: string) {
		if (this.config.casing === "PascalCase") {
			return jsConvert.toPascalCase(str);
		} else if (this.config.casing === "snake_case") {
			return jsConvert.toSnakeCase(str);
		}
		return jsConvert.toCamelCase(str);
	}

	/**
	 * Log values to the console, all non-strings will be stringified.
	 * @param args The values to be logged.
	 */
	log(...args: unknown[]) {
		const stringArgs = new Array<string>();
		for (const arg of args) {
			stringArgs.push(typeof arg === "string" ? arg : JSON.stringify(arg));
		}
		this.logger.info(stringArgs.join(", "));
		return stringArgs;
	}

	/**
	 * Gets the source file for a file.
	 * @param file The file path
	 */
	getSourceFile(file: string): ts.SourceFile {
		return expect(this.program.getSourceFile(file), "getSourceFile");
	}
}
