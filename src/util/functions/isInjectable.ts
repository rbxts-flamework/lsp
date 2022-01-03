import type ts from "typescript";
import { Provider } from "util/provider";

const INJECTABLE_IDENTIFIERS = new Set(["Service", "Controller"]);

/**
 * Checks whether the CompletionEntry is a Service or Controller.
 */
export function isInjectable(provider: Provider, token: ts.Node, name: string, data?: ts.CompletionEntryData) {
	const { ts } = provider;
	const symbol = findSymbol(provider, token, name, data);
	if (symbol?.valueDeclaration?.decorators) {
		for (const decorator of symbol.valueDeclaration.decorators) {
			// TODO: use symbols
			if (ts.isCallExpression(decorator.expression) && ts.isIdentifier(decorator.expression.expression)) {
				const identifier = decorator.expression.expression;
				if (INJECTABLE_IDENTIFIERS.has(identifier.text)) {
					return true;
				}

				if (provider.config.injectableIdentifiers?.includes(identifier.text)) {
					return true;
				}
			}
		}
	}

	const symbolFile = symbol?.valueDeclaration?.getSourceFile();
	if (symbolFile && symbol) {
		// TODO: parse flamework.build instead of hardcoding
		if (provider.isFileInModule(symbolFile, "@flamework/components")) {
			return symbol.name === "Components";
		}
	}

	return false;
}

function findSymbol(provider: Provider, token: ts.Node, name: string, data?: ts.CompletionEntryData) {
	const { ts } = provider;

	if (data && data.fileName) {
		const file = provider.getSourceFile(data.fileName);
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
