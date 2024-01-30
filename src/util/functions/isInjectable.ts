import type ts from "typescript";
import { Provider } from "../../util/provider";
import { NodeMetadata } from "../nodeMetadata";

// TODO: We should read `flamework.build` to avoid having to hardcode symbols.
const FLAMEWORK_SYMBOLS = ["Components"];

/**
 * Checks whether the CompletionEntry can be injected into other classes.
 */
export function isInjectable(provider: Provider, name: string, token?: ts.Node, data?: ts.CompletionEntryData) {
	const symbol = findSymbol(provider, name, token, data);
	if (symbol && symbol.valueDeclaration) {
		if (FLAMEWORK_SYMBOLS.includes(symbol.name) && data && data.fileName?.includes("@flamework")) {
			return true;
		}

		const metadata = new NodeMetadata(provider, symbol.valueDeclaration);
		return metadata.isRequested("injectable");
	}

	return false;
}

/**
 * Checks whether the class declaration can inject other classes via the constructor.
 */
export function isInjector(provider: Provider, declaration: ts.ClassDeclaration) {
	const metadata = new NodeMetadata(provider, declaration);
	return metadata.isRequested("injector") || metadata.isRequested("injectable");
}

function findSymbol(provider: Provider, name: string, token?: ts.Node, data?: ts.CompletionEntryData) {
	const { ts } = provider;

	if (data && data.fileName) {
		const file = provider.program.getSourceFile(data.fileName);
		if (!file) return;

		const fileSymbol = provider.getSymbol(file);
		if (fileSymbol) {
			const exportSymbol = fileSymbol.exports?.get(ts.escapeLeadingUnderscores(data.exportName));
			if (exportSymbol) {
				return exportSymbol;
			}
		}
	}

	const symbol = provider.typeChecker.resolveName(name, token, ts.SymbolFlags.All, false);
	return symbol ? ts.skipAlias(symbol, provider.typeChecker) : undefined;
}
